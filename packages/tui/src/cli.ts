import { createRingKo, access, type ApprovalHandler, type RingKo } from "@ringko-ai/sdk";
import { registerNetworkTools, registerShellTools, registerWorkspaceTools } from "@ringko-ai/tools";
import { loadConfig, type RingkoConfig } from "./config.ts";
import { loadProviderModel } from "./provider.ts";

export const VERSION = "0.1.0";

export interface CliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

const USAGE = `ringko - RingKo agent harness CLI

Usage:
  ringko <command> [options]

Commands:
  run <prompt>       Run the agent
  tools              List the registered tools
  info               Show the access mode
  version            Print the version
  help               Show this help

Options:
  --config <path>    Config file (default: ringko.config.json)
  --provider <name>  Override the configured provider (default: echo)
  --model <id>       Override the configured model id
  --workspace <dir>  Workspace root for file tools (default: current directory)

Providers are introduced through configuration; the config names a provider
module that is imported at run time. See "provider" in ringko.config.json.
`;

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
  config?: string;
  provider?: string;
  model?: string;
  workspace?: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const positionals: string[] = [];
  let config: string | undefined;
  let provider: string | undefined;
  let model: string | undefined;
  let workspace: string | undefined;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--config" || arg === "--provider" || arg === "--model" || arg === "--workspace") {
      const value = rest[i + 1];
      if (value === undefined) throw new TypeError(`Missing value for ${arg}.`);
      if (arg === "--config") config = value;
      else if (arg === "--provider") provider = value;
      else if (arg === "--model") model = value;
      else workspace = value;
      i += 1;
    } else {
      positionals.push(arg);
    }
  }
  return { command, positionals, config, provider, model, workspace };
}

function readConfig(parsed: ParsedArgs, io: CliIo): RingkoConfig | undefined {
  try {
    return loadConfig(parsed.config);
  } catch (error) {
    io.err(error instanceof Error ? error.message : "Invalid config.");
    return undefined;
  }
}

function registerTools(ringko: RingKo, config: RingkoConfig, workspace: string): void {
  registerWorkspaceTools(ringko.tools, { workspace });
  if (config.capabilities?.network) registerNetworkTools(ringko.tools);
  if (config.capabilities?.shell) registerShellTools(ringko.tools, { cwd: workspace });
}

async function runCommand(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const prompt = parsed.positionals.join(" ").trim();
  if (prompt.length === 0) {
    io.err('run requires a prompt, e.g. `ringko run "hello"`.');
    return 1;
  }

  const config = readConfig(parsed, io);
  if (!config) return 2;

  const provider = {
    ...config.provider,
    ...(parsed.provider ? { name: parsed.provider } : {}),
    ...(parsed.model ? { model: parsed.model } : {}),
  };
  const model = await loadProviderModel(provider);
  if (typeof model === "string") {
    io.err(model);
    return 1;
  }

  const workspace = parsed.workspace ?? config.workspace ?? process.cwd();
  const ringko = createRingKo({ model, requestApproval: denyApprovals(io) });
  registerTools(ringko, config, workspace);

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
      const config = readConfig(parsed, io);
      if (!config) return 2;
      const workspace = parsed.workspace ?? config.workspace ?? process.cwd();
      const ringko = createRingKo({ model: async () => ({ content: "", toolCalls: [] }) });
      registerTools(ringko, config, workspace);
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
