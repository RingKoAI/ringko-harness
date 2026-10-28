/// <reference path="./native-source.d.ts" />
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { Worker } from "node:worker_threads";
import { SandboxUnavailableError } from "./sandbox-errors.ts";
import { sandboxEnvironment } from "./sandbox-environment.ts";
import source from "../native/windows/SandboxWin.cs" with { type: "text" };
import preparationWorker from "./windows-preparation.worker.js" with { type: "text" };

const prepared = new Map<string, { dev: bigint; ino: bigint }>();
const nativeBuilds = new Map<string, Promise<string>>();
const aclPreparations = new Map<string, Promise<void>>();
const NATIVE_BUILD_TIMEOUT_MS = 30_000;
const ACL_PREPARATION_TIMEOUT_MS = 120_000;
const PREPARATION_STOP_TIMEOUT_MS = 5000;
const NATIVE_OUTPUT_LIMIT = 1_048_576;
const PREPARED_ROOT_LIMIT = 2048;
const MAX_ENCODED_SCRIPT_CHARACTERS = 28_000;

/** Process creation itself can stall on Windows, so initialization owns a worker. */
async function execute(executable: string, args: readonly string[], options: { env: NodeJS.ProcessEnv; timeout: number }): Promise<void> {
  const worker = new Worker(new URL(`data:application/javascript,${encodeURIComponent(preparationWorker)}`), {
    env: options.env,
    workerData: { executable, args, ...options, outputLimit: NATIVE_OUTPUT_LIMIT, stopTimeout: PREPARATION_STOP_TIMEOUT_MS },
  });
  try {
    await new Promise<void>((resolve, reject) => {
      worker.once("message", (message: { ok?: boolean; message?: string }) => {
        if (message?.ok === true) resolve(); else reject(new Error(typeof message?.message === "string" ? message.message : "Windows sandbox preparation failed."));
      });
      worker.once("error", reject);
      worker.once("exit", code => reject(new Error(`Windows sandbox preparation worker exited before completion (${code}).`)));
    });
  } finally { await worker.terminate(); }
}

function home(): string {
  return join(process.env.RINGKO_HOME?.trim() || homedir(), ".ringko");
}

function compiler(): string {
  const windowsRoot = process.env.SystemRoot ?? "C:\\Windows";
  const candidates = [
    join(windowsRoot, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    join(windowsRoot, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
  ];
  const selected = candidates.find(existsSync);
  if (!selected) throw new SandboxUnavailableError("The system .NET Framework C# compiler is unavailable.");
  return selected;
}

function nativeBuildPaths() {
  if (process.platform !== "win32") throw new SandboxUnavailableError("Windows sandbox is only available on Windows.");
  const digest = createHash("sha256").update(source).update("jsonl-conpty-v2-pinned-compiler").digest("hex").slice(0, 16);
  const bin = join(home(), "bin");
  const executable = join(bin, `ringko-sandbox-${digest}.exe`);
  return { bin, executable };
}

function stageBuild(bin: string) {
  mkdirSync(bin, { recursive: true, mode: 0o700 });
  const staging = mkdtempSync(join(bin, "sandbox-build-"));
  try {
    const sourcePath = join(staging, "SandboxWin.cs");
    const binaryPath = join(staging, "sandbox.exe");
    writeFileSync(sourcePath, source, { mode: 0o600, flag: "wx" });
    const csc = compiler();
    return { staging, binaryPath, csc, args: ["/nologo", "/target:exe", "/optimize+", `/reference:${join(dirname(csc), "System.Web.Extensions.dll")}`, `/out:${binaryPath}`, sourcePath] };
  } catch (error) { rmSync(staging, { recursive: true, force: true }); throw error; }
}

function installBuild(binaryPath: string, executable: string): void {
  if (!existsSync(binaryPath)) throw new SandboxUnavailableError("The Windows sandbox compiler did not produce an executable.");
  try { renameSync(binaryPath, executable); }
  catch (error) { if (!existsSync(executable)) throw error; }
}

export function ensureWindowsSandbox(): string {
  const { bin, executable } = nativeBuildPaths();
  if (existsSync(executable)) return executable;
  const build = stageBuild(bin);
  try {
    const result = spawnSync(build.csc, build.args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: NATIVE_BUILD_TIMEOUT_MS,
      maxBuffer: NATIVE_OUTPUT_LIMIT,
      env: sandboxEnvironment(build.staging),
    });
    if (result.status !== 0) {
      throw new SandboxUnavailableError(`Could not build the Windows sandbox helper: ${result.stderr || result.stdout || "compiler unavailable"}`);
    }
    installBuild(build.binaryPath, executable);
  } finally {
    rmSync(build.staging, { recursive: true, force: true });
  }
  return executable;
}

async function ensureWindowsSandboxAsync(): Promise<string> {
  const { bin, executable } = nativeBuildPaths();
  if (existsSync(executable)) return executable;
  const active = nativeBuilds.get(executable);
  if (active) return active;
  const pending = (async () => {
    const build = stageBuild(bin);
    try {
      await execute(build.csc, build.args, { timeout: NATIVE_BUILD_TIMEOUT_MS, env: sandboxEnvironment(build.staging) });
      installBuild(build.binaryPath, executable);
      return executable;
    } catch (error) {
      throw new SandboxUnavailableError(`Could not build the Windows sandbox helper: ${error instanceof Error ? error.message : "compiler unavailable"}`);
    } finally { rmSync(build.staging, { recursive: true, force: true }); }
  })();
  nativeBuilds.set(executable, pending);
  try { return await pending; }
  finally { if (nativeBuilds.get(executable) === pending) nativeBuilds.delete(executable); }
}

function sidFor(path: string, temp: boolean): string {
  const digest = createHash("sha256").update(temp ? "temp\0" : "", "utf8").update(path, "utf8").digest();
  const first = (digest.readUInt32LE(0) % (2 ** 30 - 1)) + 1;
  const second = (digest.readUInt32LE(4) % (2 ** 30 - 1)) + 1;
  return temp ? `S-1-4-${first}-${second}-1` : `S-1-4-${first}-${second}`;
}

function powershellCommand(script: string) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  // The parent may be PowerShell 7, whose module path is incompatible with
  // Windows PowerShell. Load the security cmdlets from this engine's modules.
  const engineRoot = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0");
  return { executable: join(engineRoot, "powershell.exe"), args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], options: {
    encoding: "utf8",
    windowsHide: true,
    env: { ...sandboxEnvironment(tmpdir()), PSModulePath: join(engineRoot, "Modules") },
    timeout: ACL_PREPARATION_TIMEOUT_MS, maxBuffer: NATIVE_OUTPUT_LIMIT,
  } };
}

interface Grant { path: string; sid: string; rights: "Modify" | "FullControl" }
function grantKey(grant: Grant): string { return JSON.stringify([grant.path, grant.sid, grant.rights]); }
function grantScript({ path, sid, rights }: Grant): string {
  const escaped = path.replaceAll("'", "''");
  const icacls = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "icacls.exe").replaceAll("'", "''");
  return [
    `$path='${escaped}'`,
    `$sid='${sid}'`,
    "$acl=Get-Acl -LiteralPath $path",
    `$rights='${rights}'`,
    "$present=$acl.Access | Where-Object { $_.IdentityReference.Value -eq $sid -and (($_.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::$rights) -eq [System.Security.AccessControl.FileSystemRights]::$rights) }",
    "if (-not $present) {",
    "  $rule=New-Object System.Security.AccessControl.FileSystemAccessRule((New-Object System.Security.Principal.SecurityIdentifier($sid)),$rights,'ContainerInherit,ObjectInherit','None','Allow')",
    "  $acl.AddAccessRule($rule)",
    "  Set-Acl -LiteralPath $path $acl",
    "}",
    // Inheritable label propagation avoids a per-file traversal: /T opens every
    // entry individually, errors on unreadable ones, and scales poorly on large
    // workspaces. Skip the write entirely when the root already carries an
    // inheritable Low label, since re-applying it re-walks the whole tree.
    `$label=& '${icacls}' $path 2>$null | Out-String`,
    "if ($label -notmatch 'Low Mandatory Level' -or $label -notmatch '\\(OI\\)\\(CI\\)') {",
    `  & '${icacls}' $path '/setintegritylevel' '(OI)(CI)L' '/Q'`,
    "  if ($LASTEXITCODE -ne 0) { throw 'Could not label the Windows sandbox root.' }",
    "}",
  ].join("; ");
}

function pendingGrants(mode: "read-only" | "workspace-write", workspace: string, temp: string, additionalRoots: readonly string[]): Grant[] {
  const grants: Grant[] = [{ path: temp, sid: sidFor(temp, true), rights: "FullControl" }];
  if (mode === "workspace-write") for (const path of [workspace, ...additionalRoots]) grants.push({ path, sid: sidFor(path, false), rights: "Modify" });
  return grants.filter(grant => {
    const identity = statSync(grant.path, { bigint: true });
    if (!identity.isDirectory()) throw new SandboxUnavailableError("A sandbox writable root is not a directory.");
    const cached = prepared.get(grantKey(grant));
    return !cached || identity.ino === 0n || cached.dev !== identity.dev || cached.ino !== identity.ino;
  });
}
function markPrepared(grants: readonly Grant[]): void {
  for (const grant of grants) {
    if (prepared.size >= PREPARED_ROOT_LIMIT) { const first = prepared.keys().next().value; if (first !== undefined) prepared.delete(first); }
    const identity = statSync(grant.path, { bigint: true });
    prepared.set(grantKey(grant), { dev: identity.dev, ino: identity.ino });
  }
}

function aclCommands(grants: readonly Grant[]) {
  const commands: ReturnType<typeof powershellCommand>[] = [];
  const commandFor = (batch: readonly Grant[]) => powershellCommand(["$ErrorActionPreference='Stop'", ...batch.map(grantScript)].join("; "));
  let batch: Grant[] = [];
  for (const grant of grants) {
    if (commandFor([grant]).args.at(-1)!.length > MAX_ENCODED_SCRIPT_CHARACTERS) throw new SandboxUnavailableError("A Windows sandbox root exceeds the supported ACL preparation command length.");
    const next = [...batch, grant];
    if (commandFor(next).args.at(-1)!.length > MAX_ENCODED_SCRIPT_CHARACTERS) {
      commands.push(commandFor(batch)); batch = [grant];
    } else batch = next;
  }
  if (batch.length) commands.push(commandFor(batch));
  return commands;
}

/** Grant the private temp directory and, for workspace-write, the workspace tree. */
export function prepareWindowsAcl(mode: "read-only" | "workspace-write", workspace: string, temp: string, additionalRoots: readonly string[] = []): void {
  const grants = pendingGrants(mode, workspace, temp, additionalRoots);
  if (!grants.length) return;
  const commands = aclCommands(grants);
  const deadline = Date.now() + ACL_PREPARATION_TIMEOUT_MS;
  for (const command of commands) {
    const timeout = deadline - Date.now();
    if (timeout <= 0) throw new SandboxUnavailableError("Windows sandbox ACL preparation timed out.");
    const result = spawnSync(command.executable, command.args, { ...command.options, encoding: "utf8", timeout });
    if (result.status !== 0) throw new SandboxUnavailableError(`Could not prepare the Windows sandbox ACL: ${result.stderr || result.stdout}`);
  }
  markPrepared(grants);
}

/** Complete expensive native initialization without blocking backend HTTP/UI work. */
export async function prepareWindowsSandbox(mode: "read-only" | "workspace-write", workspace: string, temp: string, additionalRoots: readonly string[] = []): Promise<void> {
  await ensureWindowsSandboxAsync();
  const grants = pendingGrants(mode, workspace, temp, additionalRoots);
  if (!grants.length) return;
  const key = JSON.stringify(grants.map(grantKey));
  const active = aclPreparations.get(key);
  if (active) return active;
  const pending = (async () => {
    try {
      const commands = aclCommands(grants);
      const deadline = Date.now() + ACL_PREPARATION_TIMEOUT_MS;
      for (const command of commands) {
        const timeout = deadline - Date.now();
        if (timeout <= 0) throw new Error("Windows sandbox ACL preparation timed out.");
        await execute(command.executable, command.args, { env: command.options.env, timeout });
      }
      markPrepared(grants);
    } catch (error) { throw new SandboxUnavailableError(`Could not prepare the Windows sandbox ACL: ${error instanceof Error ? error.message : "preparation failed"}`); }
  })();
  aclPreparations.set(key, pending);
  try { await pending; }
  finally { if (aclPreparations.get(key) === pending) aclPreparations.delete(key); }
}
