import { defineTool, type ToolDefinition } from "@ringko-ai/harness";

export interface ShellInput {
  command: string;
  timeout?: number;
  description?: string;
}

export interface ShellOutput {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export interface ShellOptions {
  /** Directory the command runs in. */
  cwd: string;
  /** Default timeout in milliseconds when the input omits one. */
  defaultTimeoutMs?: number;
}

const MAX_TIMEOUT_MS = 600_000;

function parseShell(value: unknown): ShellInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected an object input.");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.command !== "string" || record.command.trim().length === 0) {
    throw new TypeError("Expected a non-empty string 'command'.");
  }
  const input: ShellInput = { command: record.command };
  if (record.timeout !== undefined) {
    if (typeof record.timeout !== "number" || !Number.isFinite(record.timeout) || record.timeout <= 0) {
      throw new TypeError("'timeout' must be a positive number of milliseconds.");
    }
    input.timeout = Math.min(record.timeout, MAX_TIMEOUT_MS);
  }
  if (record.description !== undefined) {
    if (typeof record.description !== "string") throw new TypeError("'description' must be a string.");
    input.description = record.description;
  }
  return input;
}

/**
 * Execute a shell command. Classified as high risk (approval required). The
 * command runs through the platform shell; keep the working directory bounded.
 */
export function createShellTool(options: ShellOptions): ToolDefinition<ShellInput, ShellOutput> {
  if (typeof options?.cwd !== "string" || options.cwd.trim().length === 0) {
    throw new TypeError("shell requires a non-empty cwd.");
  }
  const defaultTimeout = options.defaultTimeoutMs ?? 120_000;
  return defineTool<ShellInput, ShellOutput>({
    name: "shell",
    concurrency: "exclusive",
    description: "Execute a shell command in the workspace. Requires approval.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout: { type: "number" },
        description: { type: "string" },
      },
      required: ["command"],
      additionalProperties: false,
    },
    parseInput: parseShell,
    assessRisk({ command, description }) {
      return {
        kind: "shell",
        reason: description ?? `Run shell command: ${command}`,
        target: command,
      };
    },
    async execute({ command, timeout }) {
      const shell = process.platform === "win32" ? ["cmd.exe", "/d", "/s", "/c", command] : ["/bin/sh", "-c", command];
      const proc = Bun.spawn(shell, { cwd: options.cwd, stdout: "pipe", stderr: "pipe" });
      const limit = timeout ?? defaultTimeout;

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, limit);

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const exitCode = await proc.exited;
      clearTimeout(timer);

      return { command, exitCode, stdout, stderr, ...(timedOut ? { timedOut } : {}) };
    },
  });
}
