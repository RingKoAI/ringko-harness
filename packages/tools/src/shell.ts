import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { defineTool, type ToolDefinition, type JobSnapshot } from "@ringko-ai/harness";

export const SHELL_LIMITS = Object.freeze({ defaultTimeoutMs: 300_000, commandCharacters: 16_384, outputCharacters: 65_536, outputEvents: 200 });
export interface ShellInput { command: string; timeout?: number; description?: string; background?: boolean }
export interface ShellOutput { command: string; exitCode: number; stdout: string; stderr: string; timedOut?: boolean; truncated?: boolean; eventsTruncated?: boolean }
export interface ShellOptions { cwd: string; defaultTimeoutMs?: number }
function parseShell(value: unknown): ShellInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Expected an object input.");
  const data = value as Record<string, unknown>;
  if (typeof data.command !== "string" || !data.command.trim() || data.command.length > SHELL_LIMITS.commandCharacters) throw new TypeError("Expected a non-empty command up to 16384 characters.");
  if (data.timeout !== undefined && (typeof data.timeout !== "number" || !Number.isFinite(data.timeout) || data.timeout < 0)) throw new TypeError("timeout must be non-negative milliseconds (0 disables it).");
  if (data.description !== undefined && (typeof data.description !== "string" || data.description.length > 256)) throw new TypeError("Invalid shell description.");
  if (data.background !== undefined && typeof data.background !== "boolean") throw new TypeError("background must be boolean.");
  return { command: data.command, timeout: data.timeout === undefined ? undefined : data.timeout as number, description: data.description as string | undefined, background: data.background as boolean | undefined };
}
/** Terminate the process tree: Windows taskkill, POSIX process group with direct fallback. */
async function terminate(proc: ChildProcess): Promise<void> {
  if (!proc.pid) return;
  if (process.platform === "win32") {
    await new Promise<void>(resolve => {
      const killer = spawn("taskkill.exe", ["/pid", String(proc.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
      killer.once("error", () => { proc.kill(); resolve(); });
      killer.once("close", () => { proc.kill(); resolve(); });
    });
  } else {
    try { process.kill(-proc.pid, "SIGKILL"); }
    catch { proc.kill("SIGKILL"); }
  }
}
export function createShellTool(options: ShellOptions): ToolDefinition<ShellInput, ShellOutput | JobSnapshot> {
  if (typeof options?.cwd !== "string" || !options.cwd.trim()) throw new TypeError("shell requires a cwd.");
  const configuredTimeout = options.defaultTimeoutMs ?? SHELL_LIMITS.defaultTimeoutMs;
  const defaultTimeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : SHELL_LIMITS.defaultTimeoutMs;
  return defineTool({
    name: "shell", concurrency: "exclusive",
    description: "Execute a shell command with approval. The command is killed if it exceeds the timeout: default 300s; pass timeout=0 to run without a timeout. background=true returns a jobId immediately. subscribe reads shell output/exit events; job checks results, cancels or converts foreground execution to background. Output and runtime are bounded.",
    inputSchema: { type: "object", properties: { command: { type: "string", maxLength: SHELL_LIMITS.commandCharacters }, timeout: { type: "number", description: "Timeout in milliseconds; 0 disables the timeout; optional, defaults to 300000." }, description: { type: "string", maxLength: 256 }, background: { type: "boolean" } }, required: ["command"], additionalProperties: false },
    parseInput: parseShell,
    assessRisk: ({ command, description }) => ({ kind: "shell", reason: description ?? `Run shell command: ${command}`, target: command }),
    async execute(input, context) {
      if (input.background && !context?.jobs) throw new Error("This host does not support background shell jobs.");
      const work = (signal?: AbortSignal, emit?: (type: string, data: unknown) => void): Promise<ShellOutput> => new Promise((resolve, reject) => {
        signal?.throwIfAborted();
        const executable = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
        const args = process.platform === "win32" ? ["/d", "/s", "/c", input.command] : ["-c", input.command];
        const proc = spawn(executable, args, { cwd: options.cwd, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "", stderr = "", truncated = false, timedOut = false, chunks = 0, stopping = false, eventsTruncated = false;
        let failure: unknown;
        const stop = () => { if (!stopping) { stopping = true; void terminate(proc); } };
        const limit = input.timeout ?? defaultTimeout;
        const timer = limit > 0 ? setTimeout(() => { timedOut = true; stop(); }, limit) : undefined;
        timer?.unref?.();
        const decoders = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
        const append = (channel: "stdout" | "stderr", text: string) => {
          const previous = channel === "stdout" ? stdout : stderr;
          const kept = text.slice(0, Math.max(0, SHELL_LIMITS.outputCharacters - previous.length));
          if (kept.length < text.length) truncated = true;
          if (channel === "stdout") stdout += kept; else stderr += kept;
          if (kept && emit) {
            try {
              if (chunks++ < SHELL_LIMITS.outputEvents) emit(channel, { content: kept });
              else if (!eventsTruncated) { eventsTruncated = true; emit("output_truncated", { reason: "event_limit" }); }
            }
            catch (error) { failure = error; stop(); }
          }
        };
        proc.stdout?.on("data", (data: Buffer) => append("stdout", decoders.stdout.write(data)));
        proc.stderr?.on("data", (data: Buffer) => append("stderr", decoders.stderr.write(data)));
        proc.once("error", error => { failure = error; });
        signal?.addEventListener("abort", stop, { once: true });
        if (signal?.aborted) stop();
        proc.once("close", code => {
          if (timer) clearTimeout(timer); signal?.removeEventListener("abort", stop);
          append("stdout", decoders.stdout.end()); append("stderr", decoders.stderr.end());
          if (failure) reject(failure);
          else if (signal?.aborted) reject(signal.reason);
          else resolve({ command: input.command, exitCode: code ?? -1, stdout, stderr, ...(timedOut ? { timedOut } : {}), ...(truncated ? { truncated } : {}), ...(eventsTruncated ? { eventsTruncated } : {}) });
        });
      });
      if (!context?.jobs) return await work(context?.signal);
      const job = context.jobs.start({ kind: "shell", description: input.description ?? input.command.slice(0, 120), background: input.background, signal: context.signal }, work);
      return await context.jobs.foreground(job.jobId, context.signal) as ShellOutput | JobSnapshot;
    },
  });
}
