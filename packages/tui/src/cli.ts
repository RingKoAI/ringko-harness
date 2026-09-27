import { createRingKo, access, type ApprovalHandler, type RingKo } from "@ringko-ai/sdk";
import { registerNetworkTools, registerShellTools, registerWorkspaceTools } from "@ringko-ai/tools";
import {
  configPath,
  discoverSkills,
  getConfigValue,
  loadConfig,
  loadMcpServers,
  parseConfigValue,
  saveConfig,
  setConfigValue,
  unsetConfigValue,
  type RingkoConfig,
} from "@ringko-ai/config";
import { SessionStore } from "@ringko-ai/session";
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
  run <prompt>         Run the agent
  tools                List the registered tools
  skills               List installed skills (~/.ringko/skills, ~/.agents/skills)
  mcp                  List configured MCP servers (~/.ringko/.mcp.json)
  session list         List stored sessions (~/.ringko/sessions)
  info                 Show the access mode
  config show          Print the config path and contents
  config path          Print the config path
  config set <k> <v>   Set a dotted config key (e.g. provider.model)
  config unset <k>     Remove a dotted config key
  version              Print the version
  help                 Show this help

Options:
  --config <path>      Config file (default: ~/.ringko/config)
  --provider <name>    Override the configured provider (default: echo)
  --model <id>         Override the configured model id
  --workspace <dir>    Workspace root for file tools (default: current directory)

Providers are introduced through configuration; the config names a provider
module that is imported at run time. See docs/PROVIDERS.md.
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
    return loadConfig({ path: parsed.config });
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
  const session = new SessionStore({ cwd: workspace }).create();
  const ringko = createRingKo({ model, requestApproval: denyApprovals(io), session });
  registerTools(ringko, config, workspace);

  try {
    const result = await ringko.run(prompt);
    io.out(result.content);
    io.err(`session ${session.id}`);
    return 0;
  } finally {
    session.close();
  }
}

function sessionCommand(io: CliIo): number {
  for (const meta of new SessionStore().list()) {
    io.out(`${meta.id}\t${new Date(meta.header.createdAt).toISOString()}\t${meta.header.cwd ?? ""}`);
  }
  return 0;
}

function skillsCommand(io: CliIo): number {
  for (const skill of discoverSkills()) {
    const description = skill.description ? `\t${skill.description}` : "";
    io.out(`${skill.name}\t${skill.source}\t${skill.dir}${description}`);
  }
  return 0;
}

function mcpCommand(io: CliIo): number {
  let servers;
  try {
    servers = loadMcpServers();
  } catch (error) {
    io.err(error instanceof Error ? error.message : "Invalid MCP configuration.");
    return 2;
  }
  for (const server of servers) {
    const kind = server.config.url ? "http" : "stdio";
    io.out(`${server.name}\t${server.source}\t${kind}`);
  }
  return 0;
}

function configCommand(parsed: ParsedArgs, io: CliIo): number {
  const [sub, key, value] = parsed.positionals;
  const path = parsed.config ? parsed.config : configPath();
  const config = readConfig(parsed, io);
  if (!config) return 2;

  switch (sub) {
    case undefined:
    case "show":
      io.out(path);
      io.out(`${JSON.stringify(config, null, 2)}`);
      return 0;
    case "path":
      io.out(path);
      return 0;
    case "get": {
      if (!key) {
        io.err("config get requires a key.");
        return 2;
      }
      const found = getConfigValue(config, key);
      io.out(found === undefined ? "" : JSON.stringify(found));
      return 0;
    }
    case "set": {
      if (!key || value === undefined) {
        io.err("config set requires a key and a value.");
        return 2;
      }
      const updated = setConfigValue(config, key, parseConfigValue(value));
      const saved = saveConfig(updated);
      io.out(saved);
      return 0;
    }
    case "unset": {
      if (!key) {
        io.err("config unset requires a key.");
        return 2;
      }
      const saved = saveConfig(unsetConfigValue(config, key));
      io.out(saved);
      return 0;
    }
    default:
      io.err(`Unknown config subcommand: ${sub}`);
      return 2;
  }
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
    case "skills":
      return skillsCommand(io);
    case "mcp":
      return mcpCommand(io);
    case "session":
      return sessionCommand(io);
    case "config":
      return configCommand(parsed, io);
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
