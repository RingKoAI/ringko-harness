import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import crossSpawn from "cross-spawn";
import { StringDecoder } from "node:string_decoder";
import { externalProcessEnvironment } from "@ringko-ai/tools";
import { SUBAGENT_PROCESS_LIMITS as LIMITS } from "./process-limits.ts";

export interface SpawnedProcess {
  child: ChildProcessWithoutNullStreams;
  lines(onLine: (line: string) => void): Promise<void>;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  stderrTail(): string;
  writeStdin(text: string): void;
  closeStdin(): void;
  kill(graceMs?: number): Promise<void>;
}

/** Bounded input/output, least-privilege env and owned process-tree cancellation. */
export function spawnProcess(command: string, args: readonly string[], options: { cwd: string; env?: NodeJS.ProcessEnv; inheritEnv?: readonly string[]; shell?: boolean; timeoutMs?: number }): SpawnedProcess {
  const timeoutMs = options.timeoutMs ?? LIMITS.timeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) throw new TypeError("Invalid subagent process timeout.");
  if (options.shell === true && process.platform !== "win32") throw new TypeError("Shell interpolation is unsupported for subagents; invoke a shell executable explicitly and deliver prompts through stdin.");
  const environment = externalProcessEnvironment(options.env, options.inheritEnv);
  if (process.platform === "win32" && options.shell !== false) {
    const path = Object.entries(environment).find(([name]) => name.toUpperCase() === "PATH")?.[1];
    const executable = Bun.which(command, { cwd: options.cwd, PATH: path }) ?? command;
    if (!/\.(?:exe|com)$/i.test(executable) && args.some(argument => /["%!^\r\n]/.test(argument))) {
      throw new TypeError("Windows command shims cannot safely accept quotes, %, !, ^ or newline arguments; configure the native executable or interpreter instead.");
    }
  }
  // cross-spawn safely quotes Windows .cmd shims; never hand model arguments
  // to node's shell:true command concatenation.
  const launch = process.platform === "win32" && options.shell !== false ? crossSpawn : nodeSpawn;
  const child = launch(command, [...args], {
    cwd: options.cwd, env: environment,
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    detached: process.platform !== "win32",
    shell: false,
  }) as ChildProcessWithoutNullStreams;
  let failure: Error | undefined, stopping: Promise<void> | undefined, stderr = "", stderrBytes = 0, hasClosed = false;
  const stderrDecoder = new StringDecoder("utf8");
  let closed!: () => void;
  const closure = new Promise<void>(resolve => { closed = resolve; });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", error => { failure ??= error; reject(failure); });
    child.once("close", (code, signal) => {
      hasClosed = true; clearTimeout(timer); closed();
      if (failure) reject(failure); else resolve({ code, signal });
    });
  });
  // Detached callers still await the original rejection; this observer prevents
  // startup/limit failures becoming unhandled before their consumer attaches.
  void exited.catch(() => {});
  function group(signal: NodeJS.Signals): void {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill(signal); }
  }
  const kill = (graceMs: number = LIMITS.terminateMs): Promise<void> => {
    if (stopping) return stopping;
    if (hasClosed) return Promise.resolve();
    stopping = (async () => {
      child.stdin.destroy();
      if (process.platform === "win32" && child.pid && child.exitCode === null) {
        await new Promise<void>(resolve => {
          const killer = nodeSpawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore", env: externalProcessEnvironment() });
          const timer = setTimeout(() => { killer.kill(); child.kill("SIGKILL"); resolve(); }, LIMITS.killCommandMs);
          const finish = () => { clearTimeout(timer); child.kill("SIGKILL"); resolve(); };
          killer.once("error", finish); killer.once("close", finish);
        });
      } else if (process.platform !== "win32") {
        group("SIGTERM");
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([closure, new Promise<void>(resolve => { timer = setTimeout(resolve, Math.max(0, graceMs)); })]);
        if (timer) clearTimeout(timer);
        if (!hasClosed) group("SIGKILL");
      } else child.kill("SIGKILL");
      await closure;
    })();
    return stopping;
  };
  function refuse(message: string): void { failure ??= new Error(message); void kill(); }
  child.stdin.on("error", error => { if (!stopping) { failure ??= error; void kill(); } });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBytes += chunk.byteLength;
    if (stderrBytes > LIMITS.stderrBytes) { refuse("Subagent stderr exceeded its byte limit."); return; }
    stderr = (stderr + stderrDecoder.write(chunk)).slice(-LIMITS.stderrTailCharacters);
  });
  const timer = setTimeout(() => refuse("Subagent process exceeded its deadline."), timeoutMs);
  const lines = async (onLine: (line: string) => void): Promise<void> => {
    let pending = "", bytes = 0, frames = 0;
    const decoder = new StringDecoder("utf8");
    const emit = (line: string) => {
      if (Buffer.byteLength(line) > LIMITS.lineBytes) throw new Error("Subagent stdout line exceeded its byte limit.");
      if (line.length > 0) { if (++frames > LIMITS.frames) throw new Error("Subagent stdout exceeded its event limit."); onLine(line.replace(/\r$/, "")); }
    };
    try {
      for await (const chunk of child.stdout) {
        bytes += (chunk as Buffer).byteLength;
        if (bytes > LIMITS.stdoutBytes) throw new Error("Subagent stdout exceeded its byte limit.");
        pending += decoder.write(chunk as Buffer);
        let newline: number;
        while ((newline = pending.indexOf("\n")) >= 0) { emit(pending.slice(0, newline)); pending = pending.slice(newline + 1); }
        if (Buffer.byteLength(pending) > LIMITS.lineBytes) throw new Error("Subagent stdout line exceeded its byte limit.");
      }
      pending += decoder.end(); if (pending) emit(pending);
    } catch (error) {
      failure ??= error instanceof Error ? error : new Error(String(error));
      await kill(); throw failure;
    }
  };
  return { child, lines, exited, stderrTail: () => stderr, writeStdin: text => { child.stdin.write(text); }, closeStdin: () => child.stdin.end(), kill };
}
