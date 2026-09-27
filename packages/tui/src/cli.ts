import { createRingKo, access, type ApprovalHandler, type ModelClient } from "@ringko-ai/sdk";
import { registerWorkspaceTools } from "@ringko-ai/tools";
import { createProviderClient, type ProviderName } from "@ringko-ai/providers";

export const VERSION = "0.1.0";

export interface CliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

const USAGE = `ringko - RingKo agent harness CLI

Usage:
  ringko <command> [options]

Commands:
  run <prompt>       Run the agent against a model provider
  tools              List the registered tools
  info               Show the access mode
  version            Print the version
  help               Show this help

Options:
  --provider <name>  Model provider for "run": echo | openai | anthropic (default: echo)
  --model <id>       Model id for openai/anthropic (e.g. gpt-4o-mini)
  --workspace <dir>  Workspace root for file tools (default: current directory)
`;

/**
 * A deterministic, offline model provider. It echoes the last message so the
 * binary and the tool pipeline can be exercised without network access; real
 * provider adapters replace it.
 */
export function createEchoProvider(): ModelClient {
  return async (request) => {
    const last = request.messages.at(-1)?.content ?? "";
    return { content: `echo: ${last}`, toolCalls: [] };
  };
}

/** Non-interactive default: deny every approval request (fail closed). */
function denyApprovals(io: CliIo): ApprovalHandler {
  return async (request) => {
    io.err(`approval required for "${request.toolName}" (${request.riskLevel}); denied (non-interactive)`);
    return false;
  };
}

interface ParsedArgs {
  command: string | undefined;
  positionals: string[];
  provider?: string;
  model?: string;
  workspace?: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const positionals: string[] = [];
  let provider: string | undefined;
  let model: string | undefined;
  let workspace: string | undefined;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--provider" || arg === "--model" || arg === "--workspace") {
      const value = rest[i + 1];
      if (value === undefined) throw new TypeError(`Missing value for ${arg}.`);
      if (arg === "--provider") provider = value;
      else if (arg === "--model") model = value;
      else workspace = value;
      i += 1;
    } else {
      positionals.push(arg);
    }
  }
  return { command, positionals, provider, model, workspace };
}

/** Resolve the model client for a provider name, or return an error message. */
function resolveModel(providerName: string, modelId: string | undefined): ModelClient | string {
  if (providerName === "echo") {
    return createEchoProvider();
  }
  if (providerName === "openai" || providerName === "anthropic") {
    if (!modelId) {
      return `--model is required for provider "${providerName}".`;
    }
    return createProviderClient({ provider: providerName as ProviderName, model: modelId });
  }
  return `Unknown provider "${providerName}".`;
}

function registerRingko(workspace: string, io: CliIo) {
  const ringko = createRingKo({ model: createEchoProvider(), requestApproval: denyApprovals(io) });
  registerWorkspaceTools(ringko.tools, { workspace });
  return ringko;
}

async function runCommand(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const prompt = parsed.positionals.join(" ").trim();
  if (prompt.length === 0) {
    io.err('run requires a prompt, e.g. `ringko run "hello"`.');
    return 1;
  }
  const model = resolveModel(parsed.provider ?? "echo", parsed.model);
  if (typeof model === "string") {
    io.err(model);
    return 1;
  }
  const workspace = parsed.workspace ?? process.cwd();
  const ringko = createRingKo({ model, requestApproval: denyApprovals(io) });
  registerWorkspaceTools(ringko.tools, { workspace });

  const result = await ringko.run(prompt);
  io.out(result.content);
  return 0;
}

/** Run the CLI and resolve with a process exit code. */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    io.err(error instanceof Error ? error.message : "Invalid arguments.");
    return 2;
  }

  switch (parsed.command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      io.out(USAGE);
      return 0;
    case "version":
    case "--version":
    case "-v":
      io.out(`ringko ${VERSION}`);
      return 0;
    case "info": {
      const mode = access();
      io.out(`${mode.label} (${mode.id})`);
      io.out(mode.summary);
      return 0;
    }
    case "tools": {
      const ringko = registerRingko(parsed.workspace ?? process.cwd(), io);
      for (const tool of ringko.tools.list()) io.out(tool.name);
      return 0;
    }
    case "run":
      return runCommand(parsed, io);
    default:
      io.err(`Unknown command: ${parsed.command}`);
      io.err(USAGE);
      return 1;
  }
}

if (import.meta.main) {
  void runCli(process.argv.slice(2), {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  }).then((code) => {
    process.exit(code);
  });
}
