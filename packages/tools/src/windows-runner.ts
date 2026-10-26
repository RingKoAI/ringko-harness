import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { SandboxUnavailableError } from "./sandbox-errors.ts";

const SOURCE = fileURLToPath(new URL("../native/windows/SandboxWin.cs", import.meta.url));
const prepared = new Set<string>();

function home(): string {
  return process.env.RINGKO_HOME?.trim() || join(homedir(), ".ringko");
}

function compiler(): string {
  const configured = process.env.RINGKO_CSC?.trim();
  const candidates = [
    configured,
    "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe",
    "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe",
  ].filter((value): value is string => Boolean(value));
  return candidates.find(existsSync) ?? "csc.exe";
}

export function ensureWindowsSandbox(): string {
  if (process.platform !== "win32") throw new SandboxUnavailableError("Windows sandbox is only available on Windows.");
  if (!existsSync(SOURCE)) throw new SandboxUnavailableError("Windows sandbox source is missing from this installation.");
  const digest = createHash("sha256").update(readFileSync(SOURCE)).digest("hex").slice(0, 16);
  const bin = join(home(), "bin");
  const executable = join(bin, `ringko-sandbox-${digest}.exe`);
  if (existsSync(executable)) return executable;
  mkdirSync(bin, { recursive: true });
  const result = spawnSync(compiler(), ["/nologo", "/target:exe", "/optimize+", `/out:${executable}`, SOURCE], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0 || !existsSync(executable)) {
    throw new SandboxUnavailableError(`Could not build the Windows sandbox helper: ${result.stderr || result.stdout || "compiler unavailable"}`);
  }
  return executable;
}

function sidFor(path: string, temp: boolean): string {
  const digest = createHash("sha256").update(temp ? "temp\0" : "", "utf8").update(path, "utf8").digest();
  const first = (digest.readUInt32LE(0) % (2 ** 30 - 1)) + 1;
  const second = (digest.readUInt32LE(4) % (2 ** 30 - 1)) + 1;
  return temp ? `S-1-4-${first}-${second}-1` : `S-1-4-${first}-${second}`;
}

function powershell(script: string): void {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  // The parent may be PowerShell 7, whose module path is incompatible with
  // Windows PowerShell. Load the security cmdlets from this engine's modules.
  const engineRoot = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0");
  const result = spawnSync(join(engineRoot, "powershell.exe"), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, PSModulePath: join(engineRoot, "Modules") },
  });
  if (result.status !== 0) throw new SandboxUnavailableError(`Could not prepare the Windows sandbox ACL: ${result.stderr || result.stdout}`);
}

function grant(path: string, sid: string, rights: "Modify" | "FullControl"): void {
  const escaped = path.replaceAll("'", "''");
  const script = [
    "$ErrorActionPreference='Stop'",
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
  ].join("; ");
  powershell(script);
}

function lowLabel(path: string): void {
  const result = spawnSync("icacls.exe", [path, "/setintegritylevel", "(OI)(CI)L", "/T", "/C", "/Q"], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new SandboxUnavailableError(`Could not label the Windows sandbox root: ${result.stderr || result.stdout}`);
}

/** Grant the private temp directory and, for workspace-write, the workspace tree. */
export function prepareWindowsAcl(mode: "read-only" | "workspace-write", workspace: string, temp: string): void {
  const key = `${mode}\0${workspace}\0${temp}`;
  if (prepared.has(key)) return;
  const tempSid = sidFor(temp, true);
  grant(temp, tempSid, "FullControl");
  lowLabel(temp);
  if (mode === "workspace-write") {
    grant(workspace, sidFor(workspace, false), "Modify");
    lowLabel(workspace);
  }
  prepared.add(key);
}
