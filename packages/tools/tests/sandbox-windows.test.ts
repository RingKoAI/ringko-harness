import { afterEach, beforeEach, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Sandbox } from "../src/index.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ringko-win-sandbox-"));
  writeFileSync(join(root, "seed.txt"), "seed");
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function run(sandbox: Sandbox, command: string): { status: number; stderr: string } {
  const invocation = sandbox.shell(command, root);
  const result = spawnSync(invocation.executable, invocation.args, { cwd: invocation.cwd, encoding: "utf8" });
  return { status: result.status ?? -1, stderr: result.stderr };
}

it("enforces the native Windows workspace-write and read-only boundaries", () => {
  if (process.platform !== "win32") return;
  const originalModulePath = process.env.PSModulePath;
  // A PowerShell 7 caller must not change Windows PowerShell's cmdlet loader.
  process.env.PSModulePath = join(root, "foreign-powershell-modules");
  const outside = mkdtempSync(join(tmpdir(), "ringko-win-outside-"));
  try {
    const workspace = new Sandbox({ workspace: root, mode: "workspace-write" });
    expect(run(workspace, "echo ok>ok.txt").status).toBe(0);
    expect(existsSync(join(root, "ok.txt"))).toBe(true);
    writeFileSync(join(outside, "secret.txt"), "secret");
    expect(run(workspace, `echo bad>${join(outside, "bad.txt")}`).status).not.toBe(0);
    expect(run(workspace, `del ${JSON.stringify(join(outside, "secret.txt"))}`).status).not.toBe(0);
    expect(existsSync(join(outside, "secret.txt"))).toBe(true);
    expect(existsSync(join(outside, "bad.txt"))).toBe(false);

    const readOnly = new Sandbox({ workspace: root, mode: "read-only" });
    expect(run(readOnly, "echo blocked>blocked.txt").status).not.toBe(0);
    expect(existsSync(join(root, "blocked.txt"))).toBe(false);
    expect(run(readOnly, "type seed.txt").status).toBe(0);
  } finally {
    if (originalModulePath === undefined) delete process.env.PSModulePath;
    else process.env.PSModulePath = originalModulePath;
    rmSync(outside, { recursive: true, force: true });
  }
});


