import { createRingKo, access, loopPrompt, promiseText, type ApprovalHandler, type ChatMessage, type RingKo } from "@ringko-ai/sdk";
import { resumeHint } from "./resume-hint.ts";
import { RuntimeManager, registerRuntimeTools } from "@ringko-ai/sdk/runtime";
import { resolve } from "node:path";
import { connectBackend } from "./backend.ts";
import type { BackendClient } from "@ringko-ai/client";
import {
  applyProxyEnv,
  configuredModelIds,
  createSkill,
  discoverSkills,
  getApiKey,
  getConfigValue,
  getOAuthAccount,
  getOAuthDomain,
  loadAuth,
  loadConfig,
  loadMcpServerMap,
  loadMcpServers,
  removeSkill,
  saveMcpServers,
  type McpServerConfig,
  modelLabel as selectionLabel,
  parseConfigValue,
  providerPath,
  removeOAuthAccount,
  saveConfig,
  selectModel,
  setApiKey,
  setConfigValue,
  setDefaultOAuthAccount,
  setOAuthAccount,
  settingsPath,
  unsetConfigValue,
  upsertProviderModels,
  writeDiagnostic,
  type RingkoConfig,
} from "@ringko-ai/config";
import { loginAnthropic, loginGitHubCopilot, loginOpenAiBrowser, loginOpenAiDevice, loginXaiDevice, openBrowser } from "@ringko-ai/auth";
import {
  SessionStore,
  latestSessionModel,
  recordSessionModel,
  sessionModel,
  toChatMessages,
  type SessionHandle,
} from "@ringko-ai/session";
import { discoverProviderModels, loadProviderModel } from "./provider.ts";

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
  loop <prompt>        Repeat a prompt until --completion-promise or --max-iterations
  tui                  Interactive terminal UI
  serve                Start the shared HTTP backend (TUI starts one automatically)
  service start|status|stop  Manage the shared backend of this workspace
  tools                List the registered tools
  skills               List installed skills (~/.ringko/skills, ~/.agents/skills)
  skills create <name> [description]  Create a skill
  skills remove <name> Remove a skill
  mcp                  List configured MCP servers (~/.ringko/.mcp.json)
  mcp set <name> <json>  Set an MCP server from a JSON config
  mcp remove <name>    Remove an MCP server
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
  help                 Show this help

Options:
  --config <path>      Config file (default: ~/.ringko/config)
  --provider <name>    Override the configured provider (default: echo)
  --model <id>         Override the configured model id
  --resume, -c         Continue the most recent session
  -s, --session [id]   Continue a session; omit the id for a session picker (TUI)
  --workspace <dir>    Workspace root for file tools (default: current directory)
  --server <url>       Connect to an existing local backend (or RINGKO_SERVER)
  --port <number>      (serve) HTTP port (default: 8787)
  --shared             (serve) Pin the backend to the launch workspace
  --max-iterations <n>   (loop) Stop after n iterations; 0 = unlimited (default)
  --completion-promise <text>  (loop) Stop when a reply contains <promise>text</promise>

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

interface ReplModule {
  launchRepl(options: {
    model: import("@ringko-ai/sdk").ModelClient;
    modelLabel: string;
    config: RingkoConfig;
    workspace: string;
    createModel?: (config: RingkoConfig) => Promise<import("@ringko-ai/sdk").ModelClient | string>;
    resumeSessionId?: string;
    modelId?: string;
    pickSession?: boolean;
    smallModel?: import("@ringko-ai/sdk").ModelClient;
    backend?: BackendClient;
  }): Promise<string | undefined>;
}

interface ParsedArgs {
  command: string | undefined;
  positionals: string[];
  config?: string;
  provider?: string;
  model?: string;
  workspace?: string;
  resume?: boolean;
  session?: string;
  sessionPicker?: boolean;
  server?: string;
  port?: number;
  shared?: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const [command, ...rest] = argv;
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
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--shared") { shared = true; continue; }
    if (arg === "--server" || arg === "--port") {
      const value = rest[++i];
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
      const value = rest[i + 1];
      if (value !== undefined && !value.startsWith("-")) {
        session = value;
        i += 1;
      } else {
        sessionPicker = true;
      }
      continue;
    }
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
  return { command, positionals, config, provider, model, workspace, resume, session, sessionPicker, server, port, shared };
}

function readConfig(parsed: ParsedArgs, io: CliIo): RingkoConfig | undefined {
  try {
    return loadConfig({ path: parsed.config });
  } catch (error) {
    io.err(error instanceof Error ? error.message : "Invalid config.");
    return undefined;
  }
}

function registerTools(ringko: RingKo, config: RingkoConfig, workspace: string, session?: SessionHandle): void {
  registerRuntimeTools(ringko, config, workspace, {}, session);
}

interface CliLoop { maxIterations: number; completionPromise?: string }

async function runCommand(parsed: ParsedArgs, io: CliIo, loop?: CliLoop): Promise<number> {
  const prompt = parsed.positionals.join(" ").trim();
  if (prompt.length === 0) {
    io.err(loop ? 'loop requires a prompt, e.g. `ringko loop "fix tests" --max-iterations 10`.' : 'run requires a prompt, e.g. `ringko run "hello"`.');
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
    io.err("`-s` with no id needs the interactive picker; use `ringko tui -s`.");
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
  recordSessionModel(session, selectionLabel(selection));

  const runtime = new RuntimeManager(workspace);
  void runtime.start().catch(error => writeDiagnostic("mcp.start", String(error)));
  try {
  const managed = runtime.createAgent(config, {
    model,
    task: true,
    taskModels: configuredModelIds(config),
    resolveTaskModel: async id => { const client = await loadProviderModel({ ...config, model: id }); if (typeof client === "string") throw new Error(client); return client; },
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

async function tuiCommand(parsed: ParsedArgs, io: CliIo): Promise<number> {
  if (!process.stdout.isTTY) {
    io.err("ringko tui requires an interactive terminal.");
    return 1;
  }
  const config = readConfig(parsed, io);
  if (!config) return 2;
  const workspace = parsed.workspace ?? config.workspace ?? process.cwd();
  let connection: Awaited<ReturnType<typeof connectBackend>>;
  try { connection = await connectBackend({ workspace, configPath: parsed.config, url: parsed.server }); }
  catch (error) { io.err(error instanceof Error ? error.message : "Cannot connect backend."); return 1; }
  const backend = connection.client;
  io.out(`Shared backend: ${connection.url}`);
  const sessions = await backend.sessions();
  const resumeSessionId = parsed.session ?? (parsed.resume ? sessions[0]?.id : undefined);
  if (parsed.model || parsed.provider) {
    const selection = selectModel(config, { ...(parsed.provider ? { provider: parsed.provider } : {}), ...(parsed.model ? { model: parsed.model } : {}) });
    if (!selection) { io.err("Unknown model/provider override."); return 2; }
    await backend.request("/api/model", { model: `${selection.provider.name}/${selection.model.id}` });
  }
  const info = await backend.request<{ model: string | null; modelId: string | null }>("/api/info");

  let repl: ReplModule;
  try {
    repl = (await import("@ringko-ai/repl")) as ReplModule;
  } catch (error) {
    io.err(`Cannot load @ringko-ai/repl: ${(error as Error).message}`);
    return 1;
  }
  const sessionId = await repl.launchRepl({
    // Compatibility for embedded REPL hosts; the shared TUI never invokes this model.
    model: async () => { throw new Error("Model execution belongs to the shared backend."); },
    modelLabel: info.model ?? "No model configured",
    config,
    workspace: connection.workspace,
    backend,
    ...(resumeSessionId ? { resumeSessionId } : {}),
    ...(parsed.sessionPicker ? { pickSession: true } : {}),
    ...(info.modelId ? { modelId: info.modelId } : {}),
  });
  if (sessionId && (await backend.sessions()).some(session => session.id === sessionId)) {
    io.out(resumeHint(sessionId, resolve(workspace), process.argv[1]));
  }
  return 0;
}

async function serveCommand(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const { startServer } = await import("@ringko-ai/app");
  let server;
  try {
    server = startServer({ workspace: resolve(parsed.workspace ?? process.cwd()), port: parsed.port, configPath: parsed.config, shared: parsed.shared, authToken: process.env.RINGKO_WEB_TOKEN?.trim() });
  } catch (error) { io.err(error instanceof Error ? error.message : "Backend startup failed."); return 1; }
  io.out(`RingKo backend / WebUI: ${server.url}`);
  await new Promise<void>(finish => {
    const shutdown = () => { process.off("SIGINT", shutdown); process.off("SIGTERM", shutdown); server.stop(); finish(); };
    process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
  });
  return 0;
}

const KNOWN_PROVIDER_TYPES = new Set(["openai", "openai-oauth", "anthropic", "google", "github-copilot", "xai-oauth", "openai-compatible"]);

/** Discover a provider's models (live or catalog) and persist them to provider.json. */
async function syncModels(providerName: string, fallbackType: string, io: CliIo): Promise<number> {
  let config: RingkoConfig;
  try {
    config = loadConfig({});
  } catch (error) {
    io.err(error instanceof Error ? error.message : "Invalid config.");
    return 2;
  }
  const provider = (config.providers ?? []).find((entry) => entry.name === providerName);
  // Infer an OAuth provider type when the provider is not yet in provider.json.
  const oauthType =
    providerName === "github-copilot"
      ? "github-copilot"
      : providerName === "xai" || providerName === "grok" || providerName === "xai-oauth"
        ? "xai-oauth"
        : providerName === "openai" || providerName === "openai-oauth"
          ? "openai-oauth"
          : undefined;
  const knownType = KNOWN_PROVIDER_TYPES.has(providerName) ? providerName : undefined;
  const type = provider?.type ?? provider?.vendor ?? oauthType ?? knownType ?? fallbackType;
  const apiKey = provider?.apiKey ?? getApiKey(providerName);
  const discovered = await discoverProviderModels({
    type,
    ...(provider?.baseURL ? { baseURL: provider.baseURL } : {}),
    ...(apiKey ? { apiKey } : {}),
    providerId: providerName,
  });
  if (typeof discovered === "string") {
    io.err(discovered);
    return 1;
  }
  const models = discovered;
  if (models.length === 0) {
    io.out(`no models found for ${providerName}.`);
    return 0;
  }
  saveConfig(upsertProviderModels(config, providerName, type, models));
  for (const model of models) io.out(model.id);
  io.out(`${models.length} model(s) added for ${providerName}.`);
  return 0;
}

async function modelsCommand(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const requested: string | undefined = parsed.positionals[0];
  let name: string | undefined = requested;
  if (!name) {
    try {
      const config = loadConfig({});
      const selected = config.model ?? "";
      const slash = selected.indexOf("/");
      name = slash > 0 ? selected.slice(0, slash) : config.providers?.[0]?.name;
    } catch (error) {
      io.err(error instanceof Error ? error.message : "Invalid config.");
      return 2;
    }
  }
  if (!name) {
    io.err("models requires a provider name; none configured.");
    return 2;
  }
  return syncModels(name, "openai-compatible", io);
}

function normalizeAuthDomain(value: string): string {
  if (value === "openai" || value === "chatgpt" || value === "oauth") return "openai-oauth";
  if (value === "copilot") return "github-copilot";
  if (value === "xai" || value === "grok" || value === "grok-oauth") return "xai-oauth";
  if (value === "anthropic" || value === "claude" || value === "claude-oauth") return "anthropic-oauth";
  return value;
}

async function authCommand(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const [sub, domainArg, ...flags] = parsed.positionals;
  switch (sub) {
    case undefined:
    case "list":
    case "status": {
      const state = loadAuth();
      let shown = false;
      for (const [domain, entry] of Object.entries(state.oauth)) {
        for (const account of entry.accounts) {
          shown = true;
          const label = account.credential.login ?? account.credential.accountId ?? account.id;
          const isDefault = entry.defaultAccountId === account.id ? " (default)" : "";
          io.out(`${domain}\t${label}${isDefault}`);
        }
      }
      for (const id of Object.keys(state.apikeys)) {
        shown = true;
        io.out(`${id}\tapikey\tkey=***`);
      }
      if (!shown) io.out("no credentials stored.");
      return 0;
    }
    case "set": {
      const id = domainArg;
      const key = flags[0];
      if (!id || !key) {
        io.err("auth set requires <provider> <api-key>.");
        return 2;
      }
      setApiKey(id, key);
      io.out(`stored API key for ${id}.`);
      return 0;
    }
    case "default": {
      const domain = normalizeAuthDomain(domainArg ?? "");
      const accountId = flags[0];
      if (!domain || !accountId) {
        io.err("auth default requires <domain> <account-id>.");
        return 2;
      }
      setDefaultOAuthAccount(domain, accountId);
      io.out(`default account for ${domain} set to ${accountId}.`);
      return 0;
    }
    case "logout": {
      const domain = normalizeAuthDomain(domainArg ?? "openai");
      const accountId = flags[0];
      const entry = getOAuthDomain(domain);
      const targets = accountId ? entry.accounts.filter((account) => account.id === accountId) : entry.accounts;
      if (targets.length === 0) {
        io.out(`no account to remove for ${domain}.`);
        return 0;
      }
      for (const account of targets) removeOAuthAccount(domain, account.id);
      io.out(`removed ${targets.length} account(s) for ${domain}.`);
      return 0;
    }
    case "login": {
      const domain = normalizeAuthDomain(domainArg ?? "openai");
      if (domain !== "openai-oauth" && domain !== "github-copilot" && domain !== "xai-oauth" && domain !== "anthropic-oauth") {
        io.err(`Unsupported OAuth domain "${domain}" (supported: openai-oauth, github-copilot, xai-oauth, anthropic-oauth).`);
        return 2;
      }
      try {
        const credential =
          domain === "github-copilot"
            ? await loginGitHubCopilot((url, code) => {
                io.out(`open ${url} and enter code ${code}`);
              })
            : domain === "xai-oauth"
              ? await loginXaiDevice((url, code) => {
                  io.out(`open ${url} and enter code ${code}`);
                })
              : domain === "anthropic-oauth"
                ? await loginAnthropic((url) => {
                    io.out("open this URL to sign in:");
                    io.out(url);
                    openBrowser(url);
                  })
                : flags.includes("--device")
                  ? await loginOpenAiDevice((url, code) => {
                      io.out(`open ${url} and enter code ${code}`);
                    })
                  : await loginOpenAiBrowser((url) => {
                      io.out("open this URL to sign in:");
                      io.out(url);
                      openBrowser(url);
                    });
        const accountId = credential.accountId ?? credential.login ?? `account-${Date.now().toString(36)}`;
        setOAuthAccount(domain, { id: accountId, credential, authenticatedAt: Date.now() });
        io.out(`signed in to ${domain} as ${credential.login ?? accountId}.`);
        await syncModels(domain === "github-copilot" ? "github-copilot" : domain === "xai-oauth" ? "xai" : domain === "anthropic-oauth" ? "anthropic" : "openai", domain, io);
        return 0;
      } catch (error) {
        io.err(error instanceof Error ? error.message : "login failed.");
        return 1;
      }
    }
    default:
      io.err(`Unknown auth subcommand: ${sub}`);
      return 2;
  }
}

function sessionCommand(io: CliIo): number {
  for (const meta of new SessionStore().list()) {
    io.out(`${meta.id}\t${new Date(meta.header.createdAt).toISOString()}\t${meta.header.cwd ?? ""}`);
  }
  return 0;
}

function skillsCommand(parsed: ParsedArgs, io: CliIo): number {
  const [sub, name, ...rest] = parsed.positionals;
  if (sub === "create") {
    if (!name) {
      io.err("skills create requires <name> [description].");
      return 2;
    }
    try {
      createSkill({ name, ...(rest.length > 0 ? { description: rest.join(" ") } : {}) });
    } catch (error) {
      io.err(error instanceof Error ? error.message : "Cannot create skill.");
      return 1;
    }
    io.out(`created skill ${name}.`);
    return 0;
  }
  if (sub === "remove") {
    if (!name) {
      io.err("skills remove requires <name>.");
      return 2;
    }
    const skill = discoverSkills().find((entry) => entry.name === name);
    if (!skill) {
      io.err(`unknown skill "${name}".`);
      return 1;
    }
    try {
      removeSkill(skill.dir);
    } catch (error) {
      io.err(error instanceof Error ? error.message : "Cannot remove skill.");
      return 1;
    }
    io.out(`removed skill ${name}.`);
    return 0;
  }
  for (const skill of discoverSkills()) {
    const description = skill.description ? `\t${skill.description}` : "";
    io.out(`${skill.name}\t${skill.source}\t${skill.dir}${description}`);
  }
  return 0;
}

function mcpCommand(parsed: ParsedArgs, io: CliIo): number {
  const [sub, name, ...rest] = parsed.positionals;
  if (sub === "set") {
    if (!name || rest.length === 0) {
      io.err("mcp set requires <name> <json-config>.");
      return 2;
    }
    let config: unknown;
    try {
      config = JSON.parse(rest.join(" "));
    } catch {
      io.err("MCP config must be valid JSON.");
      return 2;
    }
    if (typeof config !== "object" || config === null || Array.isArray(config)) {
      io.err("MCP config must be a JSON object.");
      return 2;
    }
    try {
      const map = loadMcpServerMap();
      map[name] = config as McpServerConfig;
      saveMcpServers(map);
    } catch (error) {
      io.err(error instanceof Error ? error.message : "Cannot save MCP configuration.");
      return 1;
    }
    io.out(`saved MCP server ${name}.`);
    return 0;
  }
  if (sub === "remove") {
    if (!name) {
      io.err("mcp remove requires <name>.");
      return 2;
    }
    try {
      const map = loadMcpServerMap();
      if (!(name in map)) {
        io.err(`unknown MCP server "${name}".`);
        return 1;
      }
      delete map[name];
      saveMcpServers(map);
    } catch (error) {
      io.err(error instanceof Error ? error.message : "Cannot save MCP configuration.");
      return 1;
    }
    io.out(`removed MCP server ${name}.`);
    return 0;
  }
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
  const config = readConfig(parsed, io);
  if (!config) return 2;

  switch (sub) {
    case undefined:
    case "show":
      io.out(settingsPath());
      io.out(providerPath());
      io.out(`${JSON.stringify(config, null, 2)}`);
      return 0;
    case "path":
      io.out(settingsPath());
      io.out(providerPath());
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
      for (const path of saveConfig(updated)) io.out(path);
      return 0;
    }
    case "unset": {
      if (!key) {
        io.err("config unset requires a key.");
        return 2;
      }
      for (const path of saveConfig(unsetConfigValue(config, key))) io.out(path);
      return 0;
    }
    default:
      io.err(`Unknown config subcommand: ${sub}`);
      return 2;
  }
}

/** Run the CLI and resolve with a process exit code. */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  applyProxyEnv();
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
      const ringko = createRingKo({ task: true, model: async () => ({ content: "", toolCalls: [] }) });
      registerTools(ringko, config, workspace);
      for (const tool of ringko.tools.list()) io.out(tool.name);
      return 0;
    }
    case "skills":
      return skillsCommand(parsed, io);
    case "mcp":
      return mcpCommand(parsed, io);
    case "session":
      return sessionCommand(io);
    case "models":
      return modelsCommand(parsed, io);
    case "auth":
      return authCommand(parsed, io);
    case "tui":
      return tuiCommand(parsed, io);
    case "serve":
      return serveCommand(parsed, io);
    case "service": {
      const action = parsed.positionals[0] ?? "status";
      if (action !== "start" && action !== "status" && action !== "stop") { io.err("Usage: ringko service start|status|stop"); return 2; }
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

if (import.meta.main) {
  void runCli(process.argv.slice(2), {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  }).then(async (code) => {
    // Flush the resume hint before process.exit can discard pending output.
    await Promise.all([process.stdout, process.stderr].map(stream => new Promise<void>(resolve => {
      if (stream.destroyed) resolve(); else stream.write("", () => resolve());
    })));
    process.exit(code);
  });
}
