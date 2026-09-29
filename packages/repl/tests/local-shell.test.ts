import { expect, it } from "bun:test";
import { runLocalShell } from "../src/local-shell.ts";
import { toolOutputText, toolResultSummary } from "../src/state.ts";

it("executes explicit shell commands and retains nonzero exit status", async () => {
  const success = await runLocalShell("echo rkh-shell-ok", process.cwd());
  expect(success.exitCode).toBe(0);
  expect(success.stdout).toContain("rkh-shell-ok");
  const failure = await runLocalShell("exit 7", process.cwd());
  expect(failure.exitCode).toBe(7);
  expect(toolResultSummary({ id: 1, kind: "tool", toolName: "shell", failed: true, text: JSON.stringify(failure) })).toBe("Exit 7");
  expect(toolOutputText({ id: 1, kind: "tool", toolName: "shell", text: JSON.stringify(success) })).toContain("rkh-shell-ok");
});

it("rejects empty or excessive commands and pre-aborted execution", async () => {
  await expect(runLocalShell("", process.cwd())).rejects.toThrow("non-empty");
  await expect(runLocalShell("x".repeat(16385), process.cwd())).rejects.toThrow("16384");
  const controller = new AbortController(); controller.abort();
  await expect(runLocalShell("echo must-not-run", process.cwd(), controller.signal)).rejects.toThrow();
});

it("interrupts a running foreground command", async () => {
  const controller = new AbortController();
  const command = process.platform === "win32" ? "ping -n 30 127.0.0.1 > nul" : "sleep 30";
  const pending = runLocalShell(command, process.cwd(), controller.signal);
  const timer = setTimeout(() => controller.abort(), 100);
  try { await expect(pending).rejects.toThrow(); }
  finally { clearTimeout(timer); }
});
