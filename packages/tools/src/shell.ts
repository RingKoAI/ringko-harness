import { defineTool, type ToolDefinition } from "@ringko-ai/harness";

export interface RunShellInput {
  command: string;
  args: string[];
}

export interface RunShellOutput {
  command: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunShellOptions {
  /** Directory the command runs in. */
  cwd: string;
}

function parseShellInput(value: unknown): RunShellInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected an object input.");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.command !== "string" || record.command.trim().length === 0) {
    throw new TypeError("Expected a non-empty string 'command'.");
  }
  let args: string[] = [];
  if (record.args !== undefined) {
    if (!Array.isArray(record.args) || record.args.some((arg) => typeof arg !== "string")) {
      throw new TypeError("'args' must be an array of strings.");
    }
    args = record.args as string[];
  }
  return { command: record.command, args };
}

/**
 * Run an external command; classified as high risk (approval). The command is
 * executed directly (no shell interpolation) so arguments cannot be injected.
 */
export function createRunShellTool(options: RunShellOptions): ToolDefinition<RunShellInput, RunShellOutput> {
  if (typeof options?.cwd !== "string" || options.cwd.trim().length === 0) {
    throw new TypeError("run_shell requires a non-empty cwd.");
  }
  return defineTool({
    name: "run_shell",
    description: "Run an external command. Requires approval.",
    inputSchema: {
      type: "object",
      properties: { command: { type: "string" }, args: { type: "array", items: { type: "string" } } },
      required: ["command"],
      additionalProperties: false,
    },
    parseInput: parseShellInput,
    assessRisk({ command, args }) {
      return {
        kind: "shell",
        reason: `Run command: ${[command, ...args].join(" ")}`,
        target: command,
      };
    },
    async execute({ command, args }) {
      const proc = Bun.spawn([command, ...args], {
        cwd: options.cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const exitCode = await proc.exited;
      return { command, args, exitCode, stdout, stderr };
    },
  });
}
