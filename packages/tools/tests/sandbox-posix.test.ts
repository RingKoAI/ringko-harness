import { afterEach, beforeEach, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Sandbox } from "../src/index.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ringko-posix-sandbox-"));
  writeFileSync(join(root, "seed.txt"), "seed");
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function available(): boolean {
  if (process.platform === "linux") return spawnSync("bwrap", ["--unshare-pid", "--ro-bind", "/", "/", "--", "true"], { stdio: "ignore" }).status === 0;
  if (process.platform === "darwin") return existsSync("/usr/bin/sandbox-exec");
  return false;
}

function run(sandbox: Sandbox, command: string): number {
  const invocation = sandbox.shell(command, root);
  return spawnSync(invocation.executable, invocation.args, { cwd: invocation.cwd, encoding: "utf8" }).status ?? -1;
}

it("enforces the native POSIX workspace and external write boundaries", () => {
  if (!available()) return;
  const outside = mkdtempSync(join(tmpdir(), "ringko-posix-outside-"));
  try {
    const workspace = new Sandbox({ workspace: root, mode: "workspace-write" });
    expect(run(workspace, "printf ok > ok.txt")).toBe(0);
    expect(existsSync(join(root, "ok.txt"))).toBe(true);
    expect(run(workspace, `printf bad > ${JSON.stringify(join(outside, "bad.txt"))}`)).not.toBe(0);
    expect(existsSync(join(outside, "bad.txt"))).toBe(false);

    const readOnly = new Sandbox({ workspace: root, mode: "read-only" });
    expect(run(readOnly, "printf blocked > blocked.txt")).not.toBe(0);
    expect(existsSync(join(root, "blocked.txt"))).toBe(false);
    expect(run(readOnly, "cat seed.txt")).toBe(0);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

