import { afterAll, afterEach, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Sandbox } from "../src/sandbox.ts";
import { prepareWindowsAcl, resolveWindowsPolicy } from "../src/windows-runner.ts";

const nativeWindows = it.skipIf(process.platform !== "win32");
const previousHome = process.env.RINGKO_HOME;
const isolatedHome = mkdtempSync(join(tmpdir(), "rkh-acl-home-"));
process.env.RINGKO_HOME = isolatedHome;
afterAll(() => {
  if (previousHome === undefined) delete process.env.RINGKO_HOME;
  else process.env.RINGKO_HOME = previousHome;
  rmSync(isolatedHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
const icacls = join(systemRoot, "System32", "icacls.exe");
const powershell = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const cleanup: string[] = [];

afterEach(() => {
  for (const path of cleanup.splice(0)) {
    try { rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    catch {
      spawnSync(icacls, [path, "/reset", "/Q", "/T"], { stdio: "ignore" });
      rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
});

function run(executable: string, args: string[]) {
  const result = spawnSync(executable, args, { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function ps(script: string): string {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const result = run(powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded]);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "PowerShell failed.");
  return result.stdout.trim();
}

function callerSid(): string {
  return ps("[Security.Principal.WindowsIdentity]::GetCurrent().User.Value");
}

function explicitAces(path: string): string[] {
  const escaped = path.replaceAll("'", "''");
  return ps(`$a=Get-Acl -LiteralPath '${escaped}'; @($a.Access | Where-Object { -not $_.IsInherited }) | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value + '|' + [string]$_.FileSystemRights }`)
    .split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function labelMarkers(): { path: string }[] {
  const directory = join(isolatedHome, ".ringko", "acl-labels");
  try {
    return readdirSync(directory).map(file => JSON.parse(readFileSync(join(directory, file), "utf8")) as { path: string });
  } catch { return []; }
}

function workspaceWithGrant(grant: string): string {
  const path = mkdtempSync(join(tmpdir(), "rkh-acl-owner-"));
  cleanup.push(path);
  expect(run(icacls, [path, "/inheritance:r", "/Q"]).status).toBe(0);
  expect(run(icacls, [path, "/grant:r", grant, "/Q"]).status).toBe(0);
  return path;
}

function sandboxTemp(): string {
  const path = mkdtempSync(join(tmpdir(), "rkh-acl-temp-"));
  cleanup.push(path);
  return path;
}

nativeWindows("labels a workspace owned with Modify through a temporary owner grant", () => {
  const sid = callerSid();
  const workspace = workspaceWithGrant("*S-1-5-11:(OI)(CI)(M)");
  const temp = sandboxTemp();
  const result = prepareWindowsAcl("workspace-write", workspace, temp, []);
  const lowered = workspace.toLowerCase();
  expect([...result.degraded].some(root => root.toLowerCase() === lowered)).toBe(false);
  expect(run(icacls, [workspace]).stdout).toContain("Low Mandatory Level");
  // The temporary WRITE_OWNER ACE must not survive the label write.
  expect(explicitAces(workspace).some(ace => ace.startsWith(`${sid}|`))).toBe(false);
  expect(labelMarkers().some(marker => marker.path.toLowerCase() === lowered)).toBe(true);
}, 60_000);

nativeWindows("labels even when the caller has an explicit ACE and preserves it", () => {
  const sid = callerSid();
  const workspace = workspaceWithGrant(`*${sid}:(OI)(CI)(M)`);
  const temp = sandboxTemp();
  const before = explicitAces(workspace).filter(ace => ace.startsWith(`${sid}|`));
  const result = prepareWindowsAcl("workspace-write", workspace, temp, []);
  const lowered = workspace.toLowerCase();
  expect([...result.degraded].some(root => root.toLowerCase() === lowered)).toBe(false);
  expect(run(icacls, [workspace]).stdout).toContain("Low Mandatory Level");
  expect(explicitAces(workspace).filter(ace => ace.startsWith(`${sid}|`))).toEqual(before);
}, 60_000);

nativeWindows("removes an owner-only ACE left behind by a previous attempt", () => {
  const sid = callerSid();
  const workspace = workspaceWithGrant("*S-1-5-11:(OI)(CI)(M)");
  const temp = sandboxTemp();
  expect(run(icacls, [workspace, "/grant", `*${sid}:(WO)`, "/Q"]).status).toBe(0);
  expect(explicitAces(workspace).some(ace => ace.startsWith(`${sid}|`))).toBe(true);
  const result = prepareWindowsAcl("workspace-write", workspace, temp, []);
  const lowered = workspace.toLowerCase();
  expect([...result.degraded].some(root => root.toLowerCase() === lowered)).toBe(false);
  expect(run(icacls, [workspace]).stdout).toContain("Low Mandatory Level");
  expect(explicitAces(workspace).some(ace => ace.startsWith(`${sid}|`))).toBe(false);
}, 60_000);

nativeWindows("reports the effective mode and degraded roots through the Sandbox API", async () => {
  const sid = callerSid();
  const writable = workspaceWithGrant("*S-1-5-11:(OI)(CI)(M)");
  const blocked = workspaceWithGrant("*S-1-5-11:(OI)(CI)(M)");
  expect(run(icacls, [blocked, "/deny", `*${sid}:(WO)`, "/Q"]).status).toBe(0);
  const sandbox = new Sandbox({ workspace: writable, mode: "workspace-write" });
  await sandbox.prepare();
  expect(sandbox.effectiveMode).toBe("workspace-write");
  expect(sandbox.degradedWritableRoots.size).toBe(0);
  const degraded = new Sandbox({ workspace: blocked, mode: "workspace-write" });
  await degraded.prepare();
  expect(degraded.mode).toBe("workspace-write");
  expect(degraded.effectiveMode).toBe("read-only");
  expect([...degraded.degradedWritableRoots].some(root => root.toLowerCase() === blocked.toLowerCase())).toBe(true);
}, 60_000);

nativeWindows("reuses a degraded root within its retry window instead of re-walking it", () => {
  const sid = callerSid();
  const workspace = workspaceWithGrant("*S-1-5-11:(OI)(CI)(M)");
  const temp = sandboxTemp();
  expect(run(icacls, [workspace, "/deny", `*${sid}:(WO)`, "/Q"]).status).toBe(0);
  const lowered = workspace.toLowerCase();
  const first = prepareWindowsAcl("workspace-write", workspace, temp, []);
  expect([...first.degraded].some(root => root.toLowerCase() === lowered)).toBe(true);
  expect(labelMarkers().some(marker => marker.path.toLowerCase() === lowered)).toBe(false);
  expect(resolveWindowsPolicy("workspace-write", workspace, [], first.degraded)).toEqual({ mode: "read-only", writableRoots: [] });
  // Remove the cause of the degradation without clearing the retry cache.
  expect(run(icacls, [workspace, "/remove:d", `*${sid}`, "/Q"]).status).toBe(0);
  expect([...prepareWindowsAcl("workspace-write", workspace, temp, []).degraded].some(root => root.toLowerCase() === lowered)).toBe(true);
}, 60_000);
