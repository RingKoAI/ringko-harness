import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { unzipSync } from "fflate";
import { x as extractTar } from "tar";
import { NPM_PACKAGE_NAME } from "../cli-identity.ts";
import { download, type UpdateFetch } from "./download.ts";
import { UPDATE_LIMITS, UPDATE_REGISTRY, UPDATE_RELEASES, releaseVersion } from "./policy.ts";

const execute = promisify(execFile);
export type UpdateRunner = (command: string, args: string[]) => Promise<string>;
export const runUpdateCommand: UpdateRunner = async (command, args) => {
  try {
    const result = await execute(command, args, { timeout: UPDATE_LIMITS.installMs, maxBuffer: UPDATE_LIMITS.metadataBytes, windowsHide: true });
    return result.stdout;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new Error(`Update command failed (${code ?? "timeout or process failure"}); verify installation permissions and npm availability.`, { cause: error });
  }
};

export type Installation = { kind: "standalone"; executable: string } | { kind: "npm"; packageRoot: string } | { kind: "source" };

export async function detectInstallation(entry = process.argv[1], executable = process.execPath): Promise<Installation> {
  if (entry?.includes("$bunfs") || entry?.includes("~BUN") || entry === executable) return { kind: "standalone", executable: await realpath(executable) };
  if (entry) {
    const script = await realpath(entry);
    const packageRoot = dirname(dirname(script));
    try {
      const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
      if (manifest.name === NPM_PACKAGE_NAME && basename(dirname(packageRoot)) === "@ringko-ai") return { kind: "npm", packageRoot };
    } catch { /* A source checkout is not an installed public package. */ }
  }
  return { kind: "source" };
}

/** Update only the global prefix that actually owns the running package. */
export async function installNpm(version: string, packageRoot: string, run = runUpdateCommand): Promise<void> {
  releaseVersion(version);
  const npm = Bun.which("npm");
  const node = Bun.which("node");
  if (!npm || !node) throw new Error("Automatic npm updates require npm and Node.js on PATH.");
  const npmPath = await realpath(npm);
  const script = /\.js$/i.test(npmPath) ? npmPath : join(dirname(npmPath), "node_modules", "npm", "bin", "npm-cli.js");
  const prefix = (await run(node, [script, "prefix", "--global"])).trim();
  if (!prefix) throw new Error("npm returned no global installation prefix.");
  const expected = join(prefix, ...(process.platform === "win32" ? [] : ["lib"]), "node_modules", "@ringko-ai", "rkh");
  let same = false;
  try { same = await realpath(expected) === await realpath(packageRoot); } catch { /* Not the active global installation. */ }
  if (!same) throw new Error(`This is a local, npx, or non-npm installation. Update it with its original package manager (${NPM_PACKAGE_NAME}@${version}).`);
  await run(node, [script, "install", "--global", "--prefix", prefix, "--registry", UPDATE_REGISTRY, `${NPM_PACKAGE_NAME}@${version}`, "--no-audit", "--no-fund"]);
}

export function archiveTarget(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
  if ((platform === "linux" || platform === "darwin") && (arch === "x64" || arch === "arm64")) return `${platform}-${arch}`;
  if (platform === "win32" && arch === "x64") return "windows-x64";
  throw new Error(`No standalone update is published for ${platform}-${arch}.`);
}

/** Decode archive members exactly once and reject links and path traversal before writing. */
export async function unpackUpdate(archive: Uint8Array, staging: string, bundle: string, zip: boolean): Promise<void> {
  const output = join(staging, "payload");
  await mkdir(output, { mode: 0o700 });
  let files = 0, size = 0;
  const validate = (path: string, bytes: number): void => {
    if (++files > UPDATE_LIMITS.files || !Number.isSafeInteger(bytes) || bytes < 0 || (size += bytes) > UPDATE_LIMITS.extractedBytes) throw new Error("Update archive exceeds extraction limits.");
    if (path.includes("\\") || path.includes("\0") || path.startsWith("/") || path.split("/").some(part => part === ".." || part === "." || part.includes(":")) || (path !== bundle && !path.startsWith(`${bundle}/`))) throw new Error("Unsafe update archive path.");
  };
  if (zip) {
    const entries = unzipSync(archive, { filter: file => { validate(file.name, file.originalSize); return true; } });
    for (const [path, bytes] of Object.entries(entries)) {
      const child = path.slice(bundle.length).replace(/^\//, "");
      if (!child) continue;
      const target = join(output, child);
      if (path.endsWith("/")) await mkdir(target, { recursive: true, mode: 0o700 });
      else { await mkdir(dirname(target), { recursive: true, mode: 0o700 }); await writeFile(target, bytes, { flag: "wx", mode: 0o600 }); }
    }
  } else {
    const file = join(staging, "download.tar.gz");
    await writeFile(file, archive, { flag: "wx", mode: 0o600 });
    extractTar({ file, sync: true, cwd: output, strip: 1, strict: true, preservePaths: false, filter: (path, entry) => {
      validate(path, entry.size);
      if (!("type" in entry) || (entry.type !== "File" && entry.type !== "Directory")) throw new Error("Update archive contains a link or unsupported entry.");
      return true;
    } });
  }
}

/** One same-volume transaction over the executable and its sidecars, with rollback. */
export async function replaceInstallation(staging: string, replacements: { from: string; to: string }[]): Promise<void> {
  const changed: { to: string; backup: string; installed: boolean; existed: boolean }[] = [];
  try {
    for (const [index, entry] of replacements.entries()) {
      const backup = join(staging, `previous-${index}`);
      let existed = true;
      try { await lstat(entry.to); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; existed = false; }
      if (existed) await rename(entry.to, backup);
      const change = { to: entry.to, backup, existed, installed: false }; changed.push(change);
      await rename(entry.from, entry.to); change.installed = true;
    }
  } catch (error) {
    const errors: unknown[] = [error];
    for (const change of changed.reverse()) {
      try { if (change.installed) await rm(change.to, { recursive: true, force: true }); if (change.existed) await rename(change.backup, change.to); }
      catch (rollback) { errors.push(rollback); }
    }
    if (errors.length > 1) throw new AggregateError(errors, `Update rollback failed; recover backups from ${staging}.`);
    throw error;
  }
}

export async function installStandalone(version: string, executable: string, options: { fetcher?: UpdateFetch; run?: UpdateRunner; warn?: (message: string) => void } = {}): Promise<void> {
  releaseVersion(version);
  const target = archiveTarget();
  const bundle = `ringko-v${version}-${target}`;
  const zip = process.platform === "win32";
  const name = `${bundle}.${zip ? "zip" : "tar.gz"}`;
  const base = `${UPDATE_RELEASES}/download/v${version}`;
  const checksums = new TextDecoder().decode(await download(`${base}/SHA256SUMS.txt`, UPDATE_LIMITS.metadataBytes, options.fetcher));
  const checksum = checksums.split(/\r?\n/).map(line => /^([a-f0-9]{64})\s+\*?(?:\.\/)?(.+)$/.exec(line)).find(match => match?.[2] === name)?.[1];
  if (!checksum) throw new Error("The release has no SHA-256 checksum for this platform.");
  const archive = await download(`${base}/${name}`, UPDATE_LIMITS.archiveBytes, options.fetcher);
  if (createHash("sha256").update(archive).digest("hex") !== checksum) throw new Error("Update checksum mismatch; installation was not changed.");
  const staging = await mkdtemp(join(dirname(executable), ".ringko-update-"));
  let preserve = false;
  try {
    await unpackUpdate(archive, staging, bundle, zip);
    const payload = join(staging, "payload");
    const binary = join(payload, zip ? "ringko.exe" : "ringko");
    for (const path of [binary, join(payload, "webui", "index.html"), join(payload, "LICENSE"), join(payload, "NOTICE")]) if (!(await lstat(path)).isFile()) throw new Error("The update bundle is incomplete.");
    await chmod(binary, 0o755);
    const actual = (await (options.run ?? runUpdateCommand)(binary, ["version"])).trim();
    if (actual !== `ringko ${version}`) throw new Error("The downloaded executable reports a different version.");
    await replaceInstallation(staging, [
      { from: binary, to: executable },
      ...["webui", "LICENSE", "NOTICE"].map(name => ({ from: join(payload, name), to: join(dirname(executable), name) })),
    ]);
  } catch (error) { preserve = error instanceof AggregateError; throw error; }
  finally {
    if (!preserve) {
      try { await rm(staging, { recursive: true, force: true }); }
      catch { options.warn?.(`Update staging files remain at ${staging}; remove them after exiting RingKo.`); }
    }
  }
}
