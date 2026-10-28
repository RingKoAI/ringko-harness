import { afterEach, beforeEach, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Sandbox } from "../src/index.ts";
import { createShellTool } from "../src/shell.ts";

let root: string;
const nativeWindows = it.skipIf(process.platform !== "win32");
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ringko-win-sandbox-"));
  writeFileSync(join(root, "seed.txt"), "seed");
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function run(sandbox: Sandbox, command: string): { status: number; stderr: string } {
  const invocation = sandbox.shell(command, root);
  const result = spawnSync(invocation.executable, invocation.args, { cwd: invocation.cwd, env: invocation.env, encoding: "utf8" });
  return { status: result.status ?? -1, stderr: result.stderr };
}

nativeWindows("prepares a cold native runner concurrently without blocking timers or losing confinement", async () => {
  const cache = mkdtempSync(join(tmpdir(), "rkh-async-runner-"));
  const previousHome = process.env.RINGKO_HOME;
  process.env.RINGKO_HOME = cache;
  const outside = mkdtempSync(join(tmpdir(), "rkh-async-outside-"));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let initialized = false;
  const sandbox = new Sandbox({ workspace: root });
  const initialization = Promise.all([sandbox.prepare(), sandbox.prepare()]).then(() => { initialized = true; });
  try {
    await new Promise<void>(resolve => { timer = setTimeout(resolve, 0); });
    expect(initialized).toBe(false);
    await initialization;
    const files = readdirSync(join(cache, ".ringko", "bin"));
    expect(files.filter(file => file.endsWith(".exe"))).toHaveLength(1);
    expect(files.some(file => file.startsWith("sandbox-build-"))).toBe(false);
    expect(run(sandbox, "echo prepared>prepared.txt").status).toBe(0);
    expect(run(sandbox, `echo blocked>"${join(outside, "blocked.txt")}"`).status).not.toBe(0);
    expect(existsSync(join(outside, "blocked.txt"))).toBe(false);
  } finally {
    clearTimeout(timer);
    await initialization.catch(() => {});
    if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
    rmSync(cache, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(outside, { recursive: true, force: true });
  }
}, 60_000);

nativeWindows("lets the confined shell overwrite files that existed before labelling", async () => {
  const existing = join(root, "existing.txt");
  writeFileSync(existing, "before");
  const sandbox = new Sandbox({ workspace: root });
  await sandbox.prepare();
  expect(run(sandbox, "echo after>existing.txt").status).toBe(0);
  expect(readFileSync(existing, "utf8").trim()).toBe("after");
});

nativeWindows("reprepares cached writable roots after the directory is replaced", async () => {
  const first = new Sandbox({ workspace: root });
  await first.prepare();
  expect(run(first, "echo first>first.txt").status).toBe(0);
  rmSync(root, { recursive: true });
  mkdirSync(root);
  const replacement = new Sandbox({ workspace: root });
  await replacement.prepare();
  expect(run(replacement, "echo replacement>replacement.txt").status).toBe(0);
  expect(existsSync(join(root, "replacement.txt"))).toBe(true);
  const readOnly = new Sandbox({ workspace: root, mode: "read-only" });
  await readOnly.prepare();
  expect(run(readOnly, "echo denied>readonly.txt").status).not.toBe(0);
});

nativeWindows("enforces the native Windows workspace-write and read-only boundaries", () => {
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

nativeWindows("grants additional Windows roots without enabling them after a read-only downgrade", () => {
  const extra = mkdtempSync(join(tmpdir(), "ringko-extra-root-"));
  const outside = mkdtempSync(join(tmpdir(), "ringko-extra-outside-"));
  try {
    const sandbox = new Sandbox({ workspace: root, additionalWritableRoots: [extra] });
    expect(run(sandbox, `echo allowed>"${join(extra, "allowed.txt")}"`).status).toBe(0);
    expect(existsSync(join(extra, "allowed.txt"))).toBe(true);
    expect(run(sandbox, `echo blocked>"${join(outside, "blocked.txt")}"`).status).not.toBe(0);
    expect(existsSync(join(outside, "blocked.txt"))).toBe(false);
    const readOnly = new Sandbox({ workspace: root, mode: "read-only", additionalWritableRoots: [extra] });
    expect(run(readOnly, `echo blocked>"${join(extra, "blocked.txt")}"`).status).not.toBe(0);
    expect(existsSync(join(extra, "blocked.txt"))).toBe(false);
  } finally {
    rmSync(extra, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

async function nativeTerminal(sandbox: Sandbox, commands: string, disposeWhen?: () => boolean): Promise<{ output: string; exitCode: number }> {
  const invocation = sandbox.pty(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe"), ["/d"], root);
  const child = Bun.spawn([invocation.executable, ...invocation.args], { cwd: root, env: invocation.env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, 8_000);
  const stderr = new Response(child.stderr).text();
  const decoder = new TextDecoder();
  let pending = "", output = "", exitCode: number | undefined;
  try {
    for await (const chunk of child.stdout) {
      pending += decoder.decode(chunk, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const message = JSON.parse(pending.slice(0, newline)) as { type: string; data?: string; message?: string; exitCode?: number };
        pending = pending.slice(newline + 1);
        if (message.type === "ready") {
          child.stdin.write(`${JSON.stringify({ type: "resize", cols: 100, rows: 30 })}\n`);
          child.stdin.write(`${JSON.stringify({ type: "input", data: commands })}\n`);
          await child.stdin.flush();
          if (disposeWhen) {
            const deadline = Date.now() + 2_000;
            while (!disposeWhen() && Date.now() < deadline) await Bun.sleep(20);
            if (!disposeWhen()) throw new Error("Native terminal child did not start.");
            child.stdin.write(`${JSON.stringify({ type: "dispose" })}\n`);
            await child.stdin.flush();
          }
        } else if (message.type === "output") output += message.data ?? "";
        else if (message.type === "error") throw new Error(message.message ?? "Native terminal failed.");
        else if (message.type === "exit") exitCode = message.exitCode;
      }
    }
    const code = await child.exited;
    if (timedOut) throw new Error("Native terminal timed out.");
    if (exitCode === undefined) throw new Error(`Native terminal omitted its exit event (exit ${code}): ${await stderr}`);
    return { output, exitCode };
  } finally {
    clearTimeout(timer);
    child.kill();
    await child.exited;
  }
}

for (const mode of ["read-only", "workspace-write"] as const) nativeWindows(`enforces ${mode} writes inside a real restricted ConPTY`, async () => {
  const outside = mkdtempSync(join(tmpdir(), "ringko-pty-outside-"));
  const protectedPath = join(outside, "protected.txt");
  writeFileSync(protectedPath, "unchanged");
  try {
    const sandbox = new Sandbox({ workspace: root, mode });
    const result = await nativeTerminal(sandbox, `type seed.txt\r\necho inside>inside-pty.txt\r\necho bad>"${protectedPath}"\r\ndel /q "${protectedPath}"\r\necho CONPTY_DONE\r\nexit 0\r\n`);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("seed");
    expect(result.output).toContain("CONPTY_DONE");
    expect(existsSync(join(root, "inside-pty.txt"))).toBe(mode === "workspace-write");
    expect(readFileSync(protectedPath, "utf8")).toBe("unchanged");
  } finally { rmSync(outside, { recursive: true, force: true }); }
}, 30_000);

nativeWindows("disposes a running restricted ConPTY without leaving delayed child effects", async () => {
  const sandbox = new Sandbox({ workspace: root });
  const result = await nativeTerminal(sandbox, "echo started>terminal-started.txt\r\nping -n 3 127.0.0.1 > nul & echo forbidden>terminal-delayed.txt\r\n", () => existsSync(join(root, "terminal-started.txt")));
  expect(result.exitCode).not.toBe(0);
  expect(existsSync(join(root, "terminal-started.txt"))).toBe(true);
  await Bun.sleep(2_500);
  expect(existsSync(join(root, "terminal-delayed.txt"))).toBe(false);
}, 30_000);

nativeWindows("runs independent restricted ConPTY jobs concurrently", async () => {
  const sandbox = new Sandbox({ workspace: root });
  const results = await Promise.all([
    nativeTerminal(sandbox, "echo first>concurrent-first.txt\r\nexit 0\r\n"),
    nativeTerminal(sandbox, "echo second>concurrent-second.txt\r\nexit 0\r\n"),
  ]);
  expect(results.map(result => result.exitCode)).toEqual([0, 0]);
  expect(readFileSync(join(root, "concurrent-first.txt"), "utf8")).toContain("first");
  expect(readFileSync(join(root, "concurrent-second.txt"), "utf8")).toContain("second");
}, 30_000);

nativeWindows("runs Windows PowerShell with its own module environment inside the write boundary", () => {
  const originalModulePath = process.env.PSModulePath;
  process.env.PSModulePath = join(root, "foreign-modules");
  try {
    const sandbox = new Sandbox({ workspace: root });
    const executable = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const invocation = sandbox.wrap(executable, ["-NoProfile", "-NonInteractive", "-Command", "Set-Content -LiteralPath 'powershell.txt' -Value 'allowed'; Get-Content -LiteralPath 'seed.txt'"], root);
    const result = spawnSync(invocation.executable, invocation.args, { cwd: root, env: invocation.env, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("seed");
    expect(existsSync(join(root, "powershell.txt"))).toBe(true);
  } finally {
    if (originalModulePath === undefined) delete process.env.PSModulePath; else process.env.PSModulePath = originalModulePath;
  }
});

nativeWindows("inherits Windows write restrictions in child processes and filters ambient secrets", () => {
  const node = Bun.which("node");
  if (!node) throw new Error("The native sandbox test requires Node.js.");
  const outside = mkdtempSync(join(tmpdir(), "ringko-child-outside-"));
  const original = process.env.SANDBOX_TEST_TOKEN;
  process.env.SANDBOX_TEST_TOKEN = "ambient-fixture";
  try {
    const sandbox = new Sandbox({ workspace: root });
    const child = `const fs=require('node:fs');fs.writeFileSync('child.txt','allowed');try{fs.writeFileSync(${JSON.stringify(join(outside, "blocked.txt"))},'bad')}catch{process.exit(13)};process.exit(0)`;
    const script = `const result=require('node:child_process').spawnSync(process.execPath,['-e',${JSON.stringify(child)}],{stdio:'inherit'});console.log(JSON.stringify({status:result.status,ambient:process.env.SANDBOX_TEST_TOKEN??null,configured:process.env.AUTHORIZED_TOOL_TOKEN}));`;
    const invocation = sandbox.wrap(node, ["-e", script], root, { AUTHORIZED_TOOL_TOKEN: "configured-fixture" });
    const result = spawnSync(invocation.executable, invocation.args, { cwd: root, env: invocation.env, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({ status: 13, ambient: null, configured: "configured-fixture" });
    expect(existsSync(join(root, "child.txt"))).toBe(true);
    expect(existsSync(join(outside, "blocked.txt"))).toBe(false);
  } finally {
    if (original === undefined) delete process.env.SANDBOX_TEST_TOKEN; else process.env.SANDBOX_TEST_TOKEN = original;
    rmSync(outside, { recursive: true, force: true });
  }
});

nativeWindows("kills a sandboxed Windows command tree on timeout without delayed side effects", async () => {
  const tool = createShellTool({ cwd: root, sandbox: new Sandbox({ workspace: root }) });
  const result = await tool.execute(tool.parseInput({ command: "ping -n 3 127.0.0.1 > nul & echo forbidden > delayed.txt", timeout: 100 }));
  expect(result).toMatchObject({ timedOut: true });
  await Bun.sleep(2_500);
  expect(existsSync(join(root, "delayed.txt"))).toBe(false);
}, 30_000);

nativeWindows("requires an explicit full-access sandbox for external shell writes", async () => {
  const outside = mkdtempSync(join(tmpdir(), "ringko-explicit-full-"));
  const path = join(outside, "file with spaces.txt");
  try {
    const confined = createShellTool({ cwd: root });
    const denied = await confined.execute(confined.parseInput({ command: `echo blocked>"${path}"` }));
    expect(denied).toMatchObject({ exitCode: 1 });
    expect(existsSync(path)).toBe(false);
    const full = createShellTool({ cwd: root, sandbox: new Sandbox({ workspace: root, mode: "danger-full-access" }) });
    const allowed = await full.execute(full.parseInput({ command: `echo explicitly-authorized>"${path}"` }));
    expect(allowed).toMatchObject({ exitCode: 0 });
    expect(readFileSync(path, "utf8")).toContain("explicitly-authorized");
  } finally { rmSync(outside, { recursive: true, force: true }); }
}, 30_000);


