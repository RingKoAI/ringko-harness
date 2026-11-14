/// <reference path="./native-source.d.ts" />
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { Worker } from "node:worker_threads";
import { SandboxUnavailableError } from "./sandbox-errors.ts";
import { sandboxEnvironment } from "./sandbox-environment.ts";
import source from "../native/windows/SandboxWin.cs" with { type: "text" };
import preparationWorker from "./windows-preparation.worker.js" with { type: "text" };

const prepared = new Map<string, { dev: bigint; ino: bigint }>();
const degradedRoots = new Map<string, { dev: bigint; ino: bigint; until: number }>();
const nativeBuilds = new Map<string, Promise<string>>();
const aclPreparations = new Map<string, Promise<AclPreparationResult>>();
const NATIVE_BUILD_TIMEOUT_MS = 30_000;
const ACL_PREPARATION_TIMEOUT_MS = 120_000;
const ACL_DEGRADED_RETRY_MS = 60_000;
const ACL_SPAWN_RETRIES = 1;
const ACL_SPAWN_RETRY_DELAY_MS = 50;
const PREPARATION_STOP_TIMEOUT_MS = 5000;
const NATIVE_OUTPUT_LIMIT = 1_048_576;
const PREPARED_ROOT_LIMIT = 2048;
const MAX_ENCODED_SCRIPT_CHARACTERS = 28_000;

export interface AclPreparationResult {
  /** Writable roots that stay read-only because they could not be relabeled. */
  readonly degraded: ReadonlySet<string>;
  /** Roots where a temporary owner-grant ACE could not be removed after labeling. */
  readonly residualOwnerGrants: ReadonlySet<string>;
}
export interface WindowsSandboxPolicy {
  readonly mode: "read-only" | "workspace-write";
  readonly writableRoots: readonly string[];
}

export interface SpawnFailureInput {
  error?: Error & { code?: string };
  status?: number | null;
  signal?: NodeJS.Signals | null;
  stdout?: string | Uint8Array | null;
  stderr?: string | Uint8Array | null;
}

/** Keep the spawn error, status and captured output so ACL failures stay diagnosable. */
export function describeSpawnFailure(result: SpawnFailureInput): string {
  const parts: string[] = [];
  if (result.error) parts.push(`spawn ${result.error.code ?? "error"}: ${result.error.message}`);
  if (typeof result.status === "number" && result.status !== 0) parts.push(`exit ${result.status}`);
  if (result.signal) parts.push(`signal ${String(result.signal)}`);
  const text = (value?: string | Uint8Array | null): string => {
    if (typeof value === "string") return value.trim();
    if (value && value.byteLength > 0) return Buffer.from(value).toString("utf8").trim();
    return "";
  };
  const stderr = text(result.stderr), stdout = text(result.stdout);
  if (stderr) parts.push(stderr.slice(0, 2000));
  else if (stdout) parts.push(stdout.slice(0, 2000));
  return parts.join("; ") || "no diagnostic output";
}

const TRANSIENT_SPAWN_CODES = new Set(["EAGAIN", "EBUSY", "EMFILE", "ENFILE", "ENOMEM"]);

/** A failed process creation can be transient under load; retry only spawn errors. */
function spawnAclCommand(command: ReturnType<typeof powershellCommand>, timeout: number): ReturnType<typeof spawnSync> {
  const staged = stageAclScript(command);
  try {
    let result = spawnSync(staged.executable, staged.args, { ...command.options, encoding: "utf8", timeout });
    for (let attempt = 0; attempt < ACL_SPAWN_RETRIES && result.error; attempt += 1) {
      const code = (result.error as NodeJS.ErrnoException).code;
      if (!code || !TRANSIENT_SPAWN_CODES.has(code)) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ACL_SPAWN_RETRY_DELAY_MS);
      result = spawnSync(staged.executable, staged.args, { ...command.options, encoding: "utf8", timeout });
    }
    return result;
  } finally { rmSync(staged.directory, { recursive: true, force: true }); }
}

/** Process creation itself can stall on Windows, so initialization owns a worker. */
async function execute(executable: string, args: readonly string[], options: { env: NodeJS.ProcessEnv; timeout: number }): Promise<string> {
  const worker = new Worker(new URL(`data:application/javascript,${encodeURIComponent(preparationWorker)}`), {
    env: options.env,
    workerData: { executable, args, ...options, outputLimit: NATIVE_OUTPUT_LIMIT, stopTimeout: PREPARATION_STOP_TIMEOUT_MS },
  });
  try {
    return await new Promise<string>((resolve, reject) => {
      worker.once("message", (message: { ok?: boolean; message?: string; stdout?: string }) => {
        if (message?.ok === true) resolve(message.stdout ?? "");
        else reject(new Error(typeof message?.message === "string" ? message.message : "Windows sandbox preparation failed."));
      });
      worker.once("error", reject);
      worker.once("exit", code => reject(new Error(`Windows sandbox preparation worker exited before completion (${code}).`)));
    });
  } finally { await worker.terminate(); }
}

function home(): string {
  return join(process.env.RINGKO_HOME?.trim() || homedir(), ".ringko");
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/**
 * A root only carries this marker after a complete Low-label propagation.
 * A root label alone is not proof: a killed icacls run can label the root while
 * existing children still sit at Medium integrity.
 */
const LABEL_MARKER_SCHEMA = 1;
function labelMarkerPath(path: string): string {
  const digest = createHash("sha256").update(process.platform === "win32" ? path.toLowerCase() : path).digest("hex");
  return join(home(), "acl-labels", `${digest.slice(0, 32)}.json`);
}
function labelMarkerValid(path: string, identity: { dev: bigint; ino: bigint }): boolean {
  try {
    const value = JSON.parse(readFileSync(labelMarkerPath(path), "utf8")) as { schema?: unknown; path?: unknown; dev?: unknown; ino?: unknown };
    return value.schema === LABEL_MARKER_SCHEMA && typeof value.path === "string" && samePath(value.path, path)
      && value.dev === identity.dev.toString() && value.ino === identity.ino.toString();
  } catch { return false; }
}
function writeLabelMarker(path: string, identity: { dev: bigint; ino: bigint }): void {
  try {
    const file = labelMarkerPath(path);
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify({ schema: LABEL_MARKER_SCHEMA, path, dev: identity.dev.toString(), ino: identity.ino.toString() }), { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(temporary, file);
  } catch { /* The in-memory prepared cache still covers this process. */ }
}
function removeLabelMarker(path: string): void {
  try { unlinkSync(labelMarkerPath(path)); } catch { /* absent or unwritable */ }
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
      throw new SandboxUnavailableError(`Could not build the Windows sandbox helper: ${describeSpawnFailure(result)}`);
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

/** Long encoded commands can fail in a compiled Windows host. Execute the same
 * bounded policy script from a private, exclusive file, preserving Unicode for PS5. */
function stageAclScript(command: ReturnType<typeof powershellCommand>) {
  const directory = mkdtempSync(join(tmpdir(), "ringko-acl-"));
  try {
    const script = join(directory, "prepare.ps1");
    const encoded = command.args.at(-1)!;
    writeFileSync(script, "\uFEFF" + Buffer.from(encoded, "base64").toString("utf16le"), { encoding: "utf8", mode: 0o600, flag: "wx" });
    return { executable: command.executable, args: [...command.args.slice(0, -2), "-File", script], directory };
  } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
}

interface Grant { path: string; sid: string; rights: "Modify" | "FullControl" }
function grantKey(grant: Grant): string { return JSON.stringify([grant.path, grant.sid, grant.rights]); }
/** DACL-only native writer: Set-Acl also writes the SACL and needs SeSecurityPrivilege. */
const DACL_WRITER_SOURCE = `using System;
using System.Runtime.InteropServices;
public static class RkhDacl {
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern uint ConvertStringSecurityDescriptorToSecurityDescriptorW(string sddl, uint revision, out IntPtr descriptor, out uint size);
  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool GetSecurityDescriptorDacl(IntPtr descriptor, out bool present, out IntPtr dacl, out bool defaulted);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern uint SetNamedSecurityInfoW(string name, int objectType, uint securityInfo, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
  [DllImport("kernel32.dll")]
  static extern IntPtr LocalFree(IntPtr handle);
  public static int SetDacl(string path, string sddl) {
    IntPtr descriptor;
    uint size;
    if (ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, out descriptor, out size) == 0) return Marshal.GetLastWin32Error();
    try {
      bool present, defaulted;
      IntPtr dacl;
      if (!GetSecurityDescriptorDacl(descriptor, out present, out dacl, out defaulted) || !present) return -1;
      return (int)SetNamedSecurityInfoW(path, 1, 4, IntPtr.Zero, IntPtr.Zero, dacl, IntPtr.Zero);
    } finally { LocalFree(descriptor); }
  }
}`;

function aclScriptPrologue(): string {
  return [
    `if (-not ('RkhDacl' -as [type])) { Add-Type -TypeDefinition '${DACL_WRITER_SOURCE}' }`,
    "function Set-RkhDacl([string]$Path, [string]$Sddl) { return [RkhDacl]::SetDacl($Path, $Sddl) }",
    // Windows PowerShell turns native stderr into a terminating error under
    // ErrorActionPreference=Stop, so this helper relaxes it for icacls only.
    "$icaclsPath=Join-Path $env:SystemRoot 'System32\\icacls.exe'",
    "function Set-RkhLowLabel([string]$Path) { $previous=$ErrorActionPreference; $ErrorActionPreference='Continue'; try { & $icaclsPath $Path '/setintegritylevel' '(OI)(CI)L' '/Q' 2>$null | Out-Null; return $LASTEXITCODE } finally { $ErrorActionPreference=$previous } }",
  ].join("; ");
}

function grantScript({ path, sid, rights }: Grant): string {
  const escaped = path.replaceAll("'", "''");
  const grantHex = rights === "FullControl" ? "0x1F01FF" : "0x1301bf";
  return [
    `$path='${escaped}'`,
    `$sid='${sid}'`,
    "$callerSid=([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value",
    "$acl=Get-Acl -LiteralPath $path",
    // A previous crash can leave the exact WO-only ACE this script adds. Strip
    // it before snapshotting the DACL; a pre-existing caller ACE is preserved.
    "$residual=@(); try { $residual=@($acl.Access | Where-Object { -not $_.IsInherited -and $_.AccessControlType -eq 'Allow' -and $_.FileSystemRights -eq [System.Security.AccessControl.FileSystemRights]::TakeOwnership -and $_.InheritanceFlags -eq [System.Security.AccessControl.InheritanceFlags]::None -and $_.PropagationFlags -eq [System.Security.AccessControl.PropagationFlags]::None -and $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -eq $callerSid } | Select-Object -First 1) } catch { }",
    `if ($residual.Count -gt 0) { $clean=Get-Acl -LiteralPath $path; $clean.RemoveAccessRule($residual[0]); if ((Set-RkhDacl $path $clean.Sddl) -eq 0) { $acl=Get-Acl -LiteralPath $path } else { Write-Output "[IL_OWNER_RESIDUAL] $path" } }`,
    `$rights='${rights}'`,
    `$grantHex='${grantHex}'`,
    "$present=$acl.Access | Where-Object { $_.IdentityReference.Value -eq $sid -and (($_.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::$rights) -eq [System.Security.AccessControl.FileSystemRights]::$rights) }",
    "$capable=$true",
    "$baseSddl=$acl.Sddl",
    "if (-not $present) {",
    `  $baseSddl=$acl.Sddl + "(A;OICI;$grantHex;;;$sid)"`,
    "  $rc=Set-RkhDacl $path $baseSddl",
    "  if ($rc -ne 0) {",
    "    $capable=$false",
    "    if ($rights -eq 'FullControl') { throw 'Could not grant the Windows sandbox temp capability SID.' }",
    "    Write-Output ('[IL_DEGRADED] ' + $path)",
    "  }",
    "}",
    // Inheritable label propagation avoids a per-file traversal: /T opens every
    // entry individually, errors on unreadable ones, and scales poorly on large
    // workspaces. Skip the write entirely when the root already carries an
    // inheritable Low label, since re-applying it re-walks the whole tree.
    // A host root where the caller owns only Modify (no WRITE_OWNER) cannot be
    // relabeled. The owner can still change the DACL, so grant itself WO on
    // this object for the label write and restore the exact DACL immediately.
    // The snapshot restore is lossless, so pre-existing caller ACEs stay
    // intact. If even the owner grant or label write fails, that root degrades
    // to read-only instead of aborting every shell. The private temp root is
    // always owned/full-control and must label; its failure stays fatal.
    // Always propagate the label for an unmarked root. Checking only the root
    // label would accept a previous run that was killed mid-propagation.
    "if ($capable) {",
    "  $labelExit=Set-RkhLowLabel $path",
    "  if ($labelExit -ne 0) {",
    `    $rc=Set-RkhDacl $path ($baseSddl + "(A;;0x00080000;;;$callerSid)")`,
    "    if ($rc -eq 0) {",
    "      $labelExit=Set-RkhLowLabel $path",
    "      $restoreRc=Set-RkhDacl $path $baseSddl",
    `      if ($restoreRc -ne 0) { Write-Output "[IL_OWNER_RESIDUAL] $path" }`,
    `      if ($labelExit -ne 0) { Write-Output "[IL_DEGRADED] $path" }`,
    "    } else { Write-Output ('[IL_DEGRADED] ' + $path) }",
    "  }",
    "}",
  ].join("; ");
}

function pendingGrants(mode: "read-only" | "workspace-write", workspace: string, temp: string, additionalRoots: readonly string[]) {
  const grants: Grant[] = [{ path: temp, sid: sidFor(temp, true), rights: "FullControl" }];
  if (mode === "workspace-write") for (const path of [workspace, ...additionalRoots]) grants.push({ path, sid: sidFor(path, false), rights: "Modify" });
  const pending: Grant[] = [], cachedDegraded: Grant[] = [], now = Date.now();
  for (const grant of grants) {
    const identity = statSync(grant.path, { bigint: true });
    if (!identity.isDirectory()) throw new SandboxUnavailableError("A sandbox writable root is not a directory.");
    const key = grantKey(grant);
    const degraded = degradedRoots.get(key);
    if (degraded && degraded.until > now && identity.ino !== 0n && degraded.dev === identity.dev && degraded.ino === identity.ino) {
      cachedDegraded.push(grant);
      continue;
    }
    if (degraded && degraded.until <= now) degradedRoots.delete(key);
    if (grant.rights === "Modify" && identity.ino !== 0n && labelMarkerValid(grant.path, identity)) {
      prepared.set(key, { dev: identity.dev, ino: identity.ino });
      continue;
    }
    const cached = prepared.get(key);
    if (!cached || identity.ino === 0n || cached.dev !== identity.dev || cached.ino !== identity.ino) pending.push(grant);
  }
  return { pending, cachedDegraded };
}
function markPrepared(grants: readonly Grant[], excluded: ReadonlySet<string> = new Set()): void {
  for (const grant of grants) {
    if (excluded.has(grant.path)) continue;
    if (prepared.size >= PREPARED_ROOT_LIMIT) { const first = prepared.keys().next().value; if (first !== undefined) prepared.delete(first); }
    const identity = statSync(grant.path, { bigint: true });
    prepared.set(grantKey(grant), { dev: identity.dev, ino: identity.ino });
  }
}
/** Degraded roots are retried after a TTL instead of re-walking the tree on every shell. */
function markDegraded(grants: readonly Grant[]): void {
  const now = Date.now() + ACL_DEGRADED_RETRY_MS;
  for (const grant of grants) {
    const identity = statSync(grant.path, { bigint: true });
    if (identity.ino === 0n) continue;
    if (degradedRoots.size >= PREPARED_ROOT_LIMIT) { const first = degradedRoots.keys().next().value; if (first !== undefined) degradedRoots.delete(first); }
    degradedRoots.set(grantKey(grant), { dev: identity.dev, ino: identity.ino, until: now });
  }
}
function recordPreparation(grants: readonly Grant[], degraded: ReadonlySet<string>): void {
  markPrepared(grants, degraded);
  for (const grant of grants) {
    const key = grantKey(grant);
    if (degraded.has(grant.path)) { prepared.delete(key); removeLabelMarker(grant.path); }
    else if (grant.rights === "Modify") {
      const identity = statSync(grant.path, { bigint: true });
      writeLabelMarker(grant.path, { dev: identity.dev, ino: identity.ino });
    }
    degradedRoots.delete(key);
  }
  markDegraded(grants.filter(grant => degraded.has(grant.path)));
}

interface AclCommand { readonly command: ReturnType<typeof powershellCommand>; readonly grants: readonly Grant[] }
function aclCommands(grants: readonly Grant[]): AclCommand[] {
  const commands: AclCommand[] = [];
  const commandFor = (batch: readonly Grant[]): AclCommand => ({
    command: powershellCommand(["$ErrorActionPreference='Stop'", aclScriptPrologue(), ...batch.map(grantScript)].join("; ")),
    grants: batch,
  });
  let batch: Grant[] = [];
  const flush = () => { if (batch.length) { commands.push(commandFor(batch)); batch = []; } };
  for (const grant of grants) {
    if (commandFor([grant]).command.args.at(-1)!.length > MAX_ENCODED_SCRIPT_CHARACTERS) throw new SandboxUnavailableError("A Windows sandbox root exceeds the supported ACL preparation command length.");
    // The private temp root has no degradation path: its failure must stay fatal.
    if (grant.rights === "FullControl") { flush(); commands.push(commandFor([grant])); continue; }
    const next = [...batch, grant];
    if (batch.length && commandFor(next).command.args.at(-1)!.length > MAX_ENCODED_SCRIPT_CHARACTERS) { flush(); batch = [grant]; }
    else batch = next;
  }
  flush();
  return commands;
}

const IL_DEGRADED_MARKER = "[IL_DEGRADED]";
const IL_OWNER_RESIDUAL_MARKER = "[IL_OWNER_RESIDUAL]";

function markerPaths(output: string, marker: string): string[] {
  const roots: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const idx = line.indexOf(marker);
    if (idx < 0) continue;
    const root = line.slice(idx + marker.length).trim();
    if (root) roots.push(root);
  }
  return roots;
}

export function degradedRootsFromOutput(output: string): string[] {
  return markerPaths(output, IL_DEGRADED_MARKER);
}

export function residualOwnerGrantsFromOutput(output: string): string[] {
  return markerPaths(output, IL_OWNER_RESIDUAL_MARKER);
}

/**
 * Collect the writable roots whose Low Mandatory Level label could not be
 * applied. A degraded root stays readable but is no longer writable by the
 * Low-IL child (Windows MIC). The temp root must always label; if it cannot,
 * the sandbox is genuinely unusable and we fail closed.
 */
function classifyIlDegraded(grants: readonly Grant[], degraded: readonly string[]): void {
  if (degraded.length === 0) return;
  const tempGrant = grants.find(g => g.rights === "FullControl");
  const tempPath = tempGrant?.path;
  const caseInsensitiveEqual = (a: string, b: string) =>
    process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (tempPath && degraded.some(root => caseInsensitiveEqual(root, tempPath))) {
    throw new SandboxUnavailableError(
      "Could not label the Windows sandbox temp root to Low integrity; the sandbox is unusable on this system.",
    );
  }
}

/** Map raw marker paths (from the PowerShell script) back to their grant paths. */
export function degradedGrantPaths(grants: readonly Grant[], degraded: readonly string[]): Set<string> {
  if (degraded.length === 0) return new Set();
  const result = new Set<string>();
  for (const root of degraded) {
    const hit = grants.find(g =>
      process.platform === "win32" ? g.path.toLowerCase() === root.toLowerCase() : g.path === root);
    if (hit) result.add(hit.path);
  }
  return result;
}

/** Effective mode after Windows MIC degradation; host-side write checks keep the requested mode. */
export function resolveWindowsPolicy(
  mode: "read-only" | "workspace-write",
  workspaceRoot: string,
  additionalRoots: readonly string[],
  degraded: ReadonlySet<string>,
): WindowsSandboxPolicy {
  if (mode !== "workspace-write") return { mode, writableRoots: [] };
  const same = (a: string, b: string) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  const isDegraded = (value: string) => [...degraded].some(root => same(root, value));
  if (isDegraded(workspaceRoot)) return { mode: "read-only", writableRoots: [] };
  return { mode, writableRoots: additionalRoots.filter(root => !isDegraded(root)) };
}

function mergeCachedPreparation(cached: readonly string[], result: AclPreparationResult): AclPreparationResult {
  return { degraded: new Set([...cached, ...result.degraded]), residualOwnerGrants: result.residualOwnerGrants };
}

/** Grant the private temp directory and, for workspace-write, the workspace tree. */
export function prepareWindowsAcl(mode: "read-only" | "workspace-write", workspace: string, temp: string, additionalRoots: readonly string[] = []): AclPreparationResult {
  const { pending, cachedDegraded } = pendingGrants(mode, workspace, temp, additionalRoots);
  const cached = cachedDegraded.map(grant => grant.path);
  if (!pending.length) return { degraded: new Set(cached), residualOwnerGrants: new Set() };
  const commands = aclCommands(pending);
  const deadline = Date.now() + ACL_PREPARATION_TIMEOUT_MS;
  const degraded: string[] = [], residual: string[] = [];
  const fail = (batch: readonly Grant[], detail: string): void => {
    if (batch.some(grant => grant.rights === "FullControl")) throw new SandboxUnavailableError(`Could not prepare the Windows sandbox ACL: ${detail}`);
    // A writable root that cannot be prepared stays read-only; the temp root
    // (always its own command) still establishes the sandbox.
    degraded.push(...batch.map(grant => grant.path));
  };
  for (const { command, grants: batch } of commands) {
    const timeout = deadline - Date.now();
    if (timeout <= 0) { fail(batch, "Windows sandbox ACL preparation timed out."); continue; }
    const result = spawnAclCommand(command, timeout);
    if (result.status !== 0) { fail(batch, describeSpawnFailure(result)); continue; }
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    degraded.push(...degradedRootsFromOutput(output));
    residual.push(...residualOwnerGrantsFromOutput(output));
  }
  classifyIlDegraded(pending, degraded);
  const excluded = degradedGrantPaths(pending, degraded);
  recordPreparation(pending, excluded);
  return mergeCachedPreparation(cached, { degraded: excluded, residualOwnerGrants: degradedGrantPaths(pending, residual) });
}

/** Complete expensive native initialization without blocking backend HTTP/UI work. */
export async function prepareWindowsSandbox(mode: "read-only" | "workspace-write", workspace: string, temp: string, additionalRoots: readonly string[] = []): Promise<AclPreparationResult> {
  await ensureWindowsSandboxAsync();
  const { pending, cachedDegraded } = pendingGrants(mode, workspace, temp, additionalRoots);
  const cached = cachedDegraded.map(grant => grant.path);
  if (!pending.length) return { degraded: new Set(cached), residualOwnerGrants: new Set() };
  const key = JSON.stringify(pending.map(grantKey));
  const active = aclPreparations.get(key);
  if (active) return mergeCachedPreparation(cached, await active);
  const work = (async (): Promise<AclPreparationResult> => {
    try {
      const commands = aclCommands(pending);
      const deadline = Date.now() + ACL_PREPARATION_TIMEOUT_MS;
      const degraded: string[] = [], residual: string[] = [];
      const fail = (batch: readonly Grant[], detail: string): void => {
        if (batch.some(grant => grant.rights === "FullControl")) throw new Error(detail);
        degraded.push(...batch.map(grant => grant.path));
      };
      for (const { command, grants: batch } of commands) {
        const timeout = deadline - Date.now();
        if (timeout <= 0) { fail(batch, "Windows sandbox ACL preparation timed out."); continue; }
        let output: string;
        try {
          const staged = stageAclScript(command);
          try { output = await execute(staged.executable, staged.args, { env: command.options.env, timeout }); }
          finally { rmSync(staged.directory, { recursive: true, force: true }); }
        }
        catch (error) { fail(batch, error instanceof Error ? error.message : String(error)); continue; }
        degraded.push(...degradedRootsFromOutput(output));
        residual.push(...residualOwnerGrantsFromOutput(output));
      }
      classifyIlDegraded(pending, degraded);
      const excluded = degradedGrantPaths(pending, degraded);
      recordPreparation(pending, excluded);
      return { degraded: excluded, residualOwnerGrants: degradedGrantPaths(pending, residual) };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new SandboxUnavailableError(`Could not prepare the Windows sandbox ACL: ${detail}`);
    }
  })();
  aclPreparations.set(key, work);
  try { return mergeCachedPreparation(cached, await work); }
  finally { if (aclPreparations.get(key) === work) aclPreparations.delete(key); }
}
