import { access, loopPrompt, promiseText, type ApprovalHandler, type ChatMessage } from "@ringko-ai/sdk";
import { cliCommand } from "./cli-identity.ts";
import { RuntimeManager } from "@ringko-ai/sdk/runtime";
import { connectBackend } from "./backend.ts";
import {
  applyProxyEnv,
  configuredModelIds,
  modelLabel as selectionLabel,
  selectModel,
  resolveSelectionContext,
  writeDiagnostic,
  type RingkoConfig,
} from "@ringko-ai/config";
import {
  SessionStore,
  latestSessionModel,
  recordSessionModel,
  sessionModel,
  toChatMessages,
  type SessionHandle,
} from "@ringko-ai/session";
import { loadProviderModel } from "./provider.ts";
import { authCommand } from "./cli/commands/auth.ts";
import { configCommand } from "./cli/commands/config.ts";
import { mcpCommand } from "./cli/commands/mcp.ts";
import { pluginsCommand } from "./cli/commands/plugins.ts";
import { modelsCommand } from "./cli/commands/models.ts";
import { webCommand } from "./cli/commands/web.ts";
import { sessionCommand } from "./cli/commands/session.ts";
import { skillsCommand } from "./cli/commands/skills.ts";
import { subagentsCommand } from "./cli/commands/subagents.ts";
import { tuiCommand } from "./cli/commands/tui.ts";
import { readConfig } from "./cli/shared.ts";
import type { CliIo, ParsedArgs } from "./cli/types.ts";

import { VERSION } from "./version.ts";
import { startupUpdate, updateCommand } from "./updates/index.ts";

export { VERSION } from "./version.ts";
export type { CliIo, ParsedArgs } from "./cli/types.ts";

const USAGE = `${cliCommand()} - RingKo agent harness

Usage:
  ${cliCommand()}                 Interactive terminal UI (default)
  ${cliCommand()} <command> [options]

Commands:
  run <prompt>         Run the agent
  loop <prompt>        Repeat a prompt until --completion-promise or --max-iterations
  web                  Start the local backend and browser UI
  service start|status|stop  Manage the shared backend of this workspace
  tools                List the registered tools
  skills               List installed skills (~/.ringko/skills, ~/.agents/skills)
  skills create <name> [description]  Create a skill
  skills remove <name> Remove a skill
  mcp                  List configured MCP servers (~/.ringko/.mcp.json)
  mcp set <name> <json>  Set an MCP server from a JSON config
  mcp remove <name>    Remove an MCP server
  plugins              List plugin directories and trust state
  plugins trust <name> Trust a plugin (from user settings)
  plugins untrust <name> Stop trusting a plugin
  subagents            List configured subagent providers
  session list         List stored sessions (~/.ringko/sessions)
  models [provider]    Discover a provider's models and save them
  auth login [provider]  Sign in via OAuth (openai | github-copilot; --device for headless)
  auth status          List stored credentials (~/.ringko/auth/auth.json)
  auth set <prov> <key>  Store an API key for a provider
  auth logout <prov>   Remove stored credentials
  info                 Show the access mode
  config show          Print the config path and contents
  config path          Print the config path
  config set <k> <v>   Set a dotted config key (e.g. provider.model)
  config unset <k>     Remove a dotted config key
  version              Print the version
  update [--check]     Check for a new stable version or install it
  help                 Show this help

Options:
  --config <path>      Explicit config file (default: ~/.ringko/settings.local.json + provider.json)
  --provider <name>    Override the configured provider (default: echo)
  --model <id>         Override the configured model id
  --resume, -c         Continue the most recent session
  -s, --session [id]   Continue a session; omit the id for the session picker
  --workspace <dir>    Workspace root for file tools (default: current directory)
  --server <url>       Connect to an existing local backend (or RINGKO_SERVER)
  --port <number>      (web) HTTP port (default: per-workspace shared port)
  --shared             (web) Pin the backend to the launch workspace
  --max-iterations <n>   (loop) Stop after n iterations; 0 = unlimited (default)
  --completion-promise <text>  (loop) Stop when a reply contains <promise>text</promise>

Providers are introduced through configuration; the config names a provider
module that is imported at run time.
`;

/** Non-interactive default: deny every approval request (fail closed). */
function denyApprovals(io: CliIo): ApprovalHandler {
  return async (request) => {
    io.err(`approval required for "${request.toolName}" (${request.riskLevel}); denied (non-interactive)`);
    return false;
  };
}

/** Dash-prefixed first tokens that are commands, not options of the default command. */
const DASH_COMMANDS = new Set(["--help", "-h", "--version", "-v"]);

function parseArgs(argv: readonly string[]): ParsedArgs {
  const [first, ...rest] = argv;
  // A leading option belongs to the default command (the terminal UI), so it
  // must not be mistaken for a command name.
  const command = first !== undefined && (!first.startsWith("-") || DASH_COMMANDS.has(first)) ? first : undefined;
  const args = command === undefined ? argv : rest;
  const positionals: string[] = [];
  let config: string | undefined;
  let provider: string | undefined;
  let model: string | undefined;
  let workspace: string | undefined;
  let resume: boolean | undefined;
  let session: string | undefined;
  let sessionPicker: boolean | undefined;
  let server: string | undefined;
  let port: number | undefined;
  let shared: boolean | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--shared") { shared = true; continue; }
    if (arg === "--server" || arg === "--port") {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new TypeError(`Missing value for ${arg}.`);
      if (arg === "--server") server = value;
      else { port = Number(value); if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError("Port must be an integer from 1 to 65535."); }
      continue;
    }
    if (arg === "--resume" || arg === "-c" || arg === "--continue") {
      resume = true;
      continue;
    }
    if (arg === "-s" || arg === "--session") {
      const value = args[i + 1];
      if (value !== undefined && !value.startsWith("-")) {
        session = value;
        i += 1;
      } else {
        sessionPicker = true;
      }
      continue;
    }
    if (arg === "--config" || arg === "--provider" || arg === "--model" || arg === "--workspace") {
      const value = args[i + 1];
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
  return { command, positionals, config, provider, model, workspace, resume, session, sessionPicker, server, port, shared };
}

interface CliLoop { maxIterations: number; completionPromise?: string }

async function runCommand(parsed: ParsedArgs, io: CliIo, loop?: CliLoop): Promise<number> {
  const prompt = parsed.positionals.join(" ").trim();
  if (prompt.length === 0) {
    io.err(loop ? `loop requires a prompt, e.g. \`${cliCommand()} loop "fix tests" --max-iterations 10\`.` : `run requires a prompt, e.g. \`${cliCommand()} run "hello"\`.`);
    return 1;
  }

  const config = readConfig(parsed, io);
  if (!config) return 2;

  const workspace = parsed.workspace ?? config.workspace ?? process.cwd();
  const store = new SessionStore({ cwd: workspace });
  const override = {
    ...(parsed.provider ? { provider: parsed.provider } : {}),
    ...(parsed.model ? { model: parsed.model } : {}),
  };
  const hasOverride = Boolean(parsed.provider || parsed.model);
  if (parsed.sessionPicker && !parsed.session) {
    io.err(`\`-s\` with no id needs the interactive picker; use \`${cliCommand()} tui -s\`.`);
    return 1;
  }

  let session: SessionHandle;
  let history: ChatMessage[] = [];
  let resumedModel: string | undefined;
  if (parsed.session || parsed.resume) {
    const id = parsed.session ?? store.list()[0]?.id;
    if (!id) {
      io.err("no session to resume.");
      return 1;
    }
    const events = store.open(id, "read").all();
    history = toChatMessages(events);
    resumedModel = sessionModel(events);
    session = store.open(id, "write");
  } else {
    session = store.create();
  }

  const chosen = hasOverride ? undefined : resumedModel ?? latestSessionModel(store) ?? config.model;
  const prioritized: RingkoConfig = chosen ? { ...config, model: chosen } : config;
  const model = await loadProviderModel(prioritized, override);
  if (typeof model === "string") {
    session.close();
    io.err(model);
    return 1;
  }
  const selection = selectModel(prioritized, override);
  let limits: Awaited<ReturnType<typeof resolveSelectionContext>>;
  try { limits = await resolveSelectionContext(selection); }
  catch (error) { session.close(); io.err(error instanceof Error ? error.message : "Cannot resolve model capacity."); return 1; }
  recordSessionModel(session, selectionLabel(selection));

  const runtime = new RuntimeManager(workspace);
  void runtime.start().catch(error => writeDiagnostic("mcp.start", String(error)));
  try {
  const managed = runtime.createAgent(config, {
    model,
    ...limits,
    task: true,
    taskModels: configuredModelIds(config),
    resolveTaskModel: async id => { const client = await loadProviderModel({ ...config, model: id }); if (typeof client === "string") throw new Error(client); return client; },
    onTaskEvent: event => {
      if (event.type === "started") io.err(`subagent ${event.description} started (${event.mode}${event.model ? ` · ${event.model}` : ""})`);
      else if (event.type === "completed") io.err(`subagent ${event.description} completed`);
      else if (event.type === "failed" || event.type === "cancelled") io.err(`subagent ${event.description} ${event.type}${event.reason ? ` (${event.reason})` : ""}`);
      else if (event.type === "event" && event.event) {
        const child = event.event;
        if (child.type === "tool_call") {
          const names = (child.message.toolCalls ?? []).map(call => call.name).join(", ");
          io.err(`subagent ${event.description}: ${names || "tool"}`);
        } else if (child.type === "model" && child.message.content.trim()) {
          io.err(`subagent ${event.description}: ${child.message.content.trim().replace(/\s+/g, " ").slice(0, 120)}`);
        }
      }
    },
    requestApproval: denyApprovals(io),
    session,
    history,
    ...(config.mode === "approval" || config.mode === "assist" || config.mode === "full" ? { accessMode: config.mode } : {}),
    ...(selection ? { modelId: selection.model.id } : {}),
  }, { report: message => io.err(message) });
  const ringko = managed.agent;

    if (!loop) {
      const result = await ringko.run(prompt);
      io.out(result.content);
    } else {
      const options = { prompt, maxIterations: loop.maxIterations, ...(loop.completionPromise !== undefined ? { completionPromise: loop.completionPromise } : {}) };
      const text = loopPrompt(options);
      io.err(`loop started (${loop.maxIterations > 0 ? `max ${loop.maxIterations}` : "unlimited"}${loop.completionPromise ? `, promise "${loop.completionPromise}"` : ""}).`);
      for (let iteration = 1; ; iteration += 1) {
        io.err(`loop iteration ${iteration}`);
        const result = await ringko.run(text);
        if (loop.completionPromise && promiseText(result.content) === loop.completionPromise) {
          io.out(result.content);
          io.err(`loop complete after ${iteration} iteration(s).`);
          break;
        }
        if (loop.maxIterations > 0 && iteration >= loop.maxIterations) {
          io.out(result.content);
          io.err(`loop stopped at its ${loop.maxIterations}-iteration limit.`);
          break;
        }
      }
    }
    io.err(`model ${selectionLabel(selection)}`);
    io.err(`session ${session.id}`);
    return 0;
  } finally {
    await runtime.close();
    session.close();
  }
}

async function loopCommand(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const parts: string[] = [];
  let maxIterations = 0;
  let completionPromise: string | undefined;
  const tokens = parsed.positionals;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token === "--max-iterations") {
      const value = tokens[index + 1];
      if (value === undefined || !/^\d+$/.test(value)) { io.err("--max-iterations must be a non-negative integer."); return 2; }
      maxIterations = Number(value);
      index += 1;
      continue;
    }
    if (token === "--completion-promise") {
      const value = tokens[index + 1];
      if (value === undefined || value.length === 0) { io.err("--completion-promise requires text."); return 2; }
      completionPromise = value;
      index += 1;
      continue;
    }
    parts.push(token);
  }
  return runCommand({ ...parsed, positionals: parts }, io, { maxIterations, ...(completionPromise !== undefined ? { completionPromise } : {}) });
}

/** Run the CLI and resolve with a process exit code. */
export async function runCli(argv: readonly string[], io: CliIo, options: { startupUpdates?: boolean } = {}): Promise<number> {
  applyProxyEnv();
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    io.err(error instanceof Error ? error.message : "Invalid arguments.");
    return 2;
  }

  if (options.startupUpdates && await startupUpdate(parsed, io)) return 0;

  switch (parsed.command) {
    case undefined:
    case "tui":
      return tuiCommand(parsed, io);
    case "help":
    case "--help":
    case "-h":
      io.out(USAGE);
      return 0;
    case "version":
    case "--version":
    case "-v":
      io.out(`${cliCommand()} ${VERSION}`);
      return 0;
    case "info": {
      const mode = access();
      io.out(`${mode.label} (${mode.id})`);
      io.out(mode.summary);
      return 0;
    }
    case "update":
      return updateCommand(parsed, io);
    case "tools": {
      const config = readConfig(parsed, io);
      if (!config) return 2;
      const workspace = parsed.workspace ?? config.workspace ?? process.cwd();
      const runtime = new RuntimeManager(workspace);
      try {
        const preview = runtime.previewTools(config);
        try { for (const tool of preview.agent.tools.list()) io.out(tool.name); }
        finally { await preview.close(); }
        return 0;
      } finally {
        await runtime.close();
      }
    }
    case "skills":
      return skillsCommand(parsed, io);
    case "mcp":
      return mcpCommand(parsed, io);
    case "plugins":
      return pluginsCommand(parsed, io);
    case "subagents":
      return subagentsCommand(parsed, io);
    case "session":
      return sessionCommand(io);
    case "models":
      return modelsCommand(parsed, io);
    case "auth":
      return authCommand(parsed, io);
    case "web":
      return webCommand(parsed, io);
    case "service": {
      const action = parsed.positionals[0] ?? "status";
      if (action !== "start" && action !== "status" && action !== "stop") { io.err(`Usage: ${cliCommand()} service start|status|stop`); return 2; }
      try {
        const config = readConfig(parsed, io); if (!config) return 2;
        const connection = await connectBackend({ workspace: parsed.workspace ?? config.workspace ?? process.cwd(), configPath: parsed.config, url: parsed.server, startIfMissing: action === "start" });
        if (action === "stop") { await connection.client.request("/api/backend/stop", {}); io.out("Shared backend stopped."); }
        else io.out(`Shared backend: ${connection.url}\nWorkspace: ${connection.workspace}`);
        return 0;
      } catch (error) { io.err(error instanceof Error ? error.message : "Service request failed."); return 1; }
    }
    case "config":
      return configCommand(parsed, io);
    case "run":
      return runCommand(parsed, io);
    case "loop":
      return loopCommand(parsed, io);
    default:
      io.err(`Unknown command: ${parsed.command}`);
      io.err(USAGE);
      return 1;
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const code = await runCli(argv, {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  }, { startupUpdates: true });
  // Flush the resume hint before process.exit can discard pending output.
  await Promise.all([process.stdout, process.stderr].map(stream => new Promise<void>(resolve => {
    if (stream.destroyed) resolve(); else stream.write("", () => resolve());
  })));
  process.exit(code);
}

if (import.meta.main) void main();
