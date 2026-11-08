import { afterEach, beforeEach, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { c as createTar } from "tar";
import { saveConfig } from "@ringko-ai/config";
import { checkForUpdate, download, type UpdateFetch } from "../src/updates/download.ts";
import { archiveTarget, detectInstallation, installNpm, installStandalone, replaceInstallation, unpackUpdate } from "../src/updates/install.ts";
import { startupUpdate, updateCommand, type UpdateServices } from "../src/updates/index.ts";
import { releaseVersion, updatePolicy } from "../src/updates/policy.ts";

let root: string, previousHome: string | undefined;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ringko-updates-")); previousHome = process.env.RINGKO_HOME; process.env.RINGKO_HOME = root; });
afterEach(() => { if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome; rmSync(root, { recursive: true, force: true }); });
function response(value: unknown): UpdateFetch { return (async () => Response.json(value)) as UpdateFetch; }
function fixture() {
  const messages: string[] = []; let checks = 0, installs = 0;
  const io = { out: (line: string) => messages.push(line), err: (line: string) => messages.push(line) };
  const deps: UpdateServices = {
    check: async () => { checks++; return { current: "0.0.0", latest: "999.0.0", available: true }; },
    detect: async () => ({ kind: "standalone", executable: "fixture" }),
    install: async () => { installs++; },
  };
  return { io, deps, messages, counts: () => ({ checks, installs }) };
}

it("uses documented update defaults and falls back visibly for invalid booleans", () => {
  const warnings: string[] = [];
  expect(updatePolicy({}, message => warnings.push(message))).toEqual({ checkOnStartup: true, autoUpdate: false });
  expect(updatePolicy({ updates: { autoUpdate: "true" as unknown as boolean } }, message => warnings.push(message)).autoUpdate).toBe(false);
  expect(updatePolicy({ updates: [] as never }, message => warnings.push(message)).checkOnStartup).toBe(true);
  expect(warnings).toHaveLength(2);
});

it("compares numeric versions and prereleases without downgrading", async () => {
  expect((await checkForUpdate("0.9.9", response({ version: "0.10.0" }))).available).toBe(true);
  expect((await checkForUpdate("1.0.0-rc.1", response({ version: "1.0.0" }))).available).toBe(true);
  expect((await checkForUpdate("1.0.1", response({ version: "1.0.0" }))).available).toBe(false);
  expect((await checkForUpdate("1.0.0+local", response({ version: "1.0.0" }))).available).toBe(false);
  expect((await checkForUpdate("1.0.0", response({ version: "2.0.0-rc.1" }))).available).toBe(false);
  expect(() => releaseVersion("1.0.0; bad")).toThrow("invalid version");
  await expect(checkForUpdate("1.0.0", response({ version: null }))).rejects.toThrow("invalid version");
});

it("rejects HTTP failures, oversized bodies, malformed metadata and timed-out requests", async () => {
  await expect(download("https://fixture", 5, (async () => new Response("abcdef")) as UpdateFetch)).rejects.toThrow("size limit");
  await expect(download("https://fixture", 5, (async () => new Response("", { status: 503 })) as UpdateFetch)).rejects.toThrow("503");
  await expect(checkForUpdate("1.0.0", (async () => new Response("not json")) as UpdateFetch)).rejects.toThrow();
  const stalled = ((_: unknown, options: RequestInit) => new Promise((_, reject) => { options.signal!.addEventListener("abort", () => reject(options.signal!.reason), { once: true }); })) as UpdateFetch;
  await expect(download("https://fixture", 5, stalled, 10)).rejects.toThrow();
});

it("does not check or install when startup detection is disabled", async () => {
  saveConfig({ updates: { checkOnStartup: false, autoUpdate: true } });
  const f = fixture();
  expect(await startupUpdate({ command: "run", positionals: ["hello"] }, f.io, f.deps)).toBe(false);
  expect(f.counts()).toEqual({ checks: 0, installs: 0 });
});

it("checks without installing by default and installs only when enabled", async () => {
  const f = fixture();
  expect(await startupUpdate({ command: "web", positionals: [] }, f.io, f.deps)).toBe(false);
  expect(f.counts()).toEqual({ checks: 1, installs: 0 });
  saveConfig({ updates: { autoUpdate: true } });
  expect(await startupUpdate({ command: "web", positionals: [] }, f.io, f.deps)).toBe(true);
  expect(f.counts()).toEqual({ checks: 2, installs: 1 });
});

it("honors explicit config and keeps help, version and service stop offline", async () => {
  const path = join(root, "explicit.json"); writeFileSync(path, JSON.stringify({ updates: { checkOnStartup: false } }));
  const f = fixture();
  for (const command of ["version", "help", "config"]) await startupUpdate({ command, positionals: [] }, f.io, f.deps);
  await startupUpdate({ command: "service", positionals: ["stop"] }, f.io, f.deps);
  await startupUpdate({ command: "run", positionals: [], config: path }, f.io, f.deps);
  expect(f.counts().checks).toBe(0);
});

it("keeps the command available on startup failure and never overwrites a checkout", async () => {
  saveConfig({ updates: { autoUpdate: true } });
  const f = fixture(); f.deps.detect = async () => ({ kind: "source" });
  expect(await startupUpdate({ command: "run", positionals: [] }, f.io, f.deps)).toBe(false);
  expect(f.counts().installs).toBe(0);
  f.deps.check = async () => { throw new Error("offline"); };
  expect(await startupUpdate({ command: "run", positionals: [] }, f.io, f.deps)).toBe(false);
  expect(f.messages.join("\n")).toContain("offline");
});

it("supports manual check-only, installation and error exit codes", async () => {
  const f = fixture();
  expect(await updateCommand({ command: "update", positionals: ["--check"] }, f.io, f.deps)).toBe(0);
  expect(f.counts().installs).toBe(0);
  expect(await updateCommand({ command: "update", positionals: [] }, f.io, f.deps)).toBe(0);
  expect(f.counts().installs).toBe(1);
  expect(await updateCommand({ command: "update", positionals: ["bad"] }, f.io, f.deps)).toBe(2);
  f.deps.install = async () => { throw new Error("permission denied"); };
  expect(await updateCommand({ command: "update", positionals: [] }, f.io, f.deps)).toBe(1);
  f.deps.check = async () => ({ current: "1.0.0", latest: "1.0.0", available: false });
  expect(await updateCommand({ command: "update", positionals: [] }, f.io, f.deps)).toBe(0);
});

it("recognizes source and published installations and rejects unsupported targets", async () => {
  expect(await detectInstallation(join(import.meta.dir, "../src/cli.ts"))).toEqual({ kind: "source" });
  const pkg = join(root, "node_modules", "@ringko-ai", "rkh"); mkdirSync(join(pkg, "bin"), { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@ringko-ai/rkh" })); writeFileSync(join(pkg, "bin", "ringko.mjs"), "");
  expect((await detectInstallation(join(pkg, "bin", "ringko.mjs"))).kind).toBe("npm");
  expect((await detectInstallation("/$bunfs/root/cli.js", process.execPath)).kind).toBe("standalone");
  expect(archiveTarget("linux", "arm64")).toBe("linux-arm64");
  expect(archiveTarget("darwin", "x64")).toBe("darwin-x64");
  expect(archiveTarget("win32", "x64")).toBe("windows-x64");
  expect(() => archiveTarget("win32", "arm64")).toThrow("No standalone update");
});

it("updates the owning npm global prefix and rejects local installs", async () => {
  const pkg = join(root, ...(process.platform === "win32" ? [] : ["lib"]), "node_modules", "@ringko-ai", "rkh"); mkdirSync(pkg, { recursive: true });
  const calls: string[][] = [];
  const runner = async (_: string, args: string[]) => { calls.push(args); return args.includes("prefix") ? root : ""; };
  await installNpm("1.2.3", pkg, runner);
  expect(calls[1]).toContain("@ringko-ai/rkh@1.2.3"); expect(calls[1]).toContain(root);
  await expect(installNpm("1.2.3", join(root, "local"), runner)).rejects.toThrow("local, npx");
});

it("unpacks zip and tar payloads while rejecting traversal and links", async () => {
  const bundle = "ringko-v1.0.0-windows-x64";
  const good = zipSync({ [`${bundle}/webui/index.html`]: strToU8("ok") });
  await unpackUpdate(good, root, bundle, true);
  expect(readFileSync(join(root, "payload", "webui", "index.html"), "utf8")).toBe("ok");
  const badStage = join(root, "bad"); mkdirSync(badStage);
  await expect(unpackUpdate(zipSync({ [`${bundle}/../escape`]: strToU8("bad") }), badStage, bundle, true)).rejects.toThrow("Unsafe");
  const tarStage = join(root, "tar"); mkdirSync(tarStage);
  const source = join(root, "source"); mkdirSync(join(source, bundle), { recursive: true }); writeFileSync(join(source, bundle, "LICENSE"), "license");
  const file = join(root, "fixture.tgz"); await createTar({ cwd: source, file, gzip: true }, [bundle]);
  await unpackUpdate(readFileSync(file), tarStage, bundle, false);
  expect(readFileSync(join(tarStage, "payload", "LICENSE"), "utf8")).toBe("license");
  symlinkSync(source, join(source, bundle, "linked"), process.platform === "win32" ? "junction" : "dir");
  const linked = join(root, "linked.tgz"); await createTar({ cwd: source, file: linked, gzip: true }, [bundle]);
  const linkStage = join(root, "link-stage"); mkdirSync(linkStage);
  await expect(unpackUpdate(readFileSync(linked), linkStage, bundle, false)).rejects.toThrow("link or unsupported");
});

it("rolls back the executable when a sidecar replacement fails", async () => {
  const executable = join(root, "ringko"); writeFileSync(executable, "old");
  const replacement = join(root, "replacement"); writeFileSync(replacement, "new");
  await expect(replaceInstallation(root, [{ from: replacement, to: executable }, { from: join(root, "missing"), to: join(root, "webui") }])).rejects.toThrow();
  expect(readFileSync(executable, "utf8")).toBe("old");
});

it("rejects checksum mismatches without changing the installed binary", async () => {
  const executable = join(root, "ringko"); writeFileSync(executable, "old");
  const name = `ringko-v1.2.3-${archiveTarget()}.${process.platform === "win32" ? "zip" : "tar.gz"}`;
  const checksum = createHash("sha256").update("different").digest("hex");
  const fetcher = (async (url: string) => new Response(url.endsWith("SHA256SUMS.txt") ? `${checksum}  ./${name}\n` : "bad")) as UpdateFetch;
  await expect(installStandalone("1.2.3", executable, { fetcher })).rejects.toThrow("checksum mismatch");
  await expect(installStandalone("1.2.3", executable, { fetcher: (async () => new Response("")) as UpdateFetch })).rejects.toThrow("no SHA-256 checksum");
  expect(readFileSync(executable, "utf8")).toBe("old");
});

it("installs a verified complete standalone bundle including its WebUI", async () => {
  const executable = join(root, process.platform === "win32" ? "custom.exe" : "custom"); writeFileSync(executable, "old");
  mkdirSync(join(root, "webui")); writeFileSync(join(root, "webui", "index.html"), "old UI");
  const version = "1.2.3", bundle = `ringko-v${version}-${archiveTarget()}`;
  const source = join(root, "source", bundle); mkdirSync(join(source, "webui"), { recursive: true });
  const files = { [process.platform === "win32" ? "ringko.exe" : "ringko"]: "new", "webui/index.html": "new UI", LICENSE: "license", NOTICE: "notice" };
  for (const [path, data] of Object.entries(files)) writeFileSync(join(source, path), data);
  let archive: Uint8Array;
  if (process.platform === "win32") archive = zipSync(Object.fromEntries(Object.entries(files).map(([path, data]) => [`${bundle}/${path}`, strToU8(data)])));
  else { const file = join(root, "fixture.tar.gz"); await createTar({ cwd: join(root, "source"), file, gzip: true }, [bundle]); archive = readFileSync(file); }
  const name = `${bundle}.${process.platform === "win32" ? "zip" : "tar.gz"}`;
  const checksum = createHash("sha256").update(archive).digest("hex");
  const fetcher: UpdateFetch = async url => new Response(url.endsWith("SHA256SUMS.txt") ? `${checksum}  ./${name}\n` : new Uint8Array(archive));
  await expect(installStandalone(version, executable, { fetcher, run: async () => "ringko 0.0.0\n" })).rejects.toThrow("different version");
  expect(readFileSync(executable, "utf8")).toBe("old");
  await installStandalone(version, executable, { fetcher, run: async () => `ringko ${version}\n` });
  expect(readFileSync(executable, "utf8")).toBe("new");
  expect(readFileSync(join(root, "webui", "index.html"), "utf8")).toBe("new UI");
});
