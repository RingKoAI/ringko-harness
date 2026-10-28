import { afterEach, beforeEach, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runLocalShell } from "../src/local-shell.ts";
import { toolOutputText, toolResultSummary } from "../src/state.ts";
// Bun's Windows child-process startup/termination can exceed the 5s default.
const SHELL_TEST_TIMEOUT_MS = process.platform === "win32" ? 30_000 : 5_000;
let workspace: string;
beforeEach(() => { workspace = mkdtempSync(join(tmpdir(), "rkh-local-shell-")); });
afterEach(() => { rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

it("executes explicit shell commands and retains nonzero exit status", async () => {
  const success = await runLocalShell("echo rkh-shell-ok", workspace);
  expect(success.exitCode).toBe(0);
  expect(success.stdout).toContain("rkh-shell-ok");
  const failure = await runLocalShell("exit 7", workspace);
  expect(failure.exitCode).toBe(7);
  expect(toolResultSummary({ id: 1, kind: "tool", toolName: "shell", failed: true, text: JSON.stringify(failure) })).toBe("Exit 7");
  expect(toolOutputText({ id: 1, kind: "tool", toolName: "shell", text: JSON.stringify(success) })).toContain("rkh-shell-ok");
}, SHELL_TEST_TIMEOUT_MS);

it("rejects empty or excessive commands and pre-aborted execution", async () => {
  await expect(runLocalShell("", workspace)).rejects.toThrow("non-empty");
  await expect(runLocalShell("x".repeat(16385), workspace)).rejects.toThrow("16384");
  const controller = new AbortController(); controller.abort();
  await expect(runLocalShell("echo must-not-run", workspace, controller.signal)).rejects.toThrow();
});

it("interrupts a running foreground command", async () => {
  const controller = new AbortController();
  const command = process.platform === "win32" ? "ping -n 30 127.0.0.1 > nul" : "sleep 30";
  const pending = runLocalShell(command, workspace, controller.signal);
  const timer = setTimeout(() => controller.abort(), 100);
  try { await expect(pending).rejects.toThrow(); }
  finally { clearTimeout(timer); }
}, SHELL_TEST_TIMEOUT_MS);

it("applies the configured write boundary to explicit human commands", async () => {
  const result = await runLocalShell("echo blocked > blocked.txt", workspace, undefined, { mode: "read-only" });
  expect(result.exitCode).not.toBe(0);
  expect(existsSync(join(workspace, "blocked.txt"))).toBe(false);
}, SHELL_TEST_TIMEOUT_MS);
