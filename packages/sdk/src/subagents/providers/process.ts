import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

export interface SpawnedProcess {
  child: ChildProcessWithoutNullStreams;
  lines(onLine: (line: string) => void): Promise<void>;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  stderrTail(): string;
  writeStdin(text: string): void;
  closeStdin(): void;
  kill(graceMs?: number): Promise<void>;
}

const MAX_STDERR = 8_192;

/** Spawn a bounded child process with line-delimited stdout and escalation on stop. */
export function spawnProcess(command: string, args: readonly string[], options: { cwd: string; env?: NodeJS.ProcessEnv; shell?: boolean }): SpawnedProcess {
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    // .cmd shims on Windows require a shell. Prompts are delivered on stdin or
    // config-owned placeholders, never as shell-interpolated user input.
    shell: options.shell ?? process.platform === "win32",
  }) as ChildProcessWithoutNullStreams;
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer | string) => {
    stderr = (stderr + chunk.toString()).slice(-MAX_STDERR);
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
  const lines = async (onLine: (line: string) => void): Promise<void> => {
    const reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
    for await (const line of reader) {
      if (line.length > 0) onLine(line);
    }
  };
  return {
    child,
    lines,
    exited,
    stderrTail: () => stderr,
    writeStdin: text => { child.stdin.write(text); },
    closeStdin: () => { try { child.stdin.end(); } catch { /* already closed */ } },
    kill: async (graceMs = 2_000) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      try { child.stdin.end(); } catch { /* ignore */ }
      child.kill();
      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* ignore */ } }, graceMs);
      try { await exited.catch(() => undefined); } finally { clearTimeout(timer); }
    },
  };
}
