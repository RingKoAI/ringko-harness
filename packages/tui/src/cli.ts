import { createRingKo, access, type ApprovalHandler, type ChatMessage, type RingKo } from "@ringko-ai/sdk";
import {
  createTodoStore,
  registerSessionTools,
  registerNetworkTools,
  registerShellTools,
  registerWorkspaceTools,
} from "@ringko-ai/tools";
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
  type RingkoConfig,
} from "@ringko-ai/config";
import { loginGoogle, loginAnthropic, loginGitHubCopilot, loginOpenAiBrowser, loginOpenAiDevice, loginXaiDevice, openBrowser } from "@ringko-ai/auth";
import {
  SessionStore,
  latestSessionModel,
  recordSessionModel,
  sessionModel,
  toChatMessages,
  sessionTodos,
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
  tui                  Interactive terminal UI
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
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
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
  return { command, positionals, config, provider, model, workspace, resume, session, sessionPicker };
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
  registerWorkspaceTools(ringko.tools, { workspace });
  const todos = createTodoStore(items => { if (session) { session.appendEvent("session/todo", { todos: items }); session.flush(); } });
  todos.todos = session ? sessionTodos(session.all()) : [];
  registerSessionTools(ringko.tools, { todos, ask: async () => { throw new Error("ask requires an interactive host; use ringko tui or Web chat."); } });
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

  const ringko = createRingKo({
    model,
    task: true,
    taskModels: configuredModelIds(config),
    resolveTaskModel: async id => { const client = await loadProviderModel({ ...config, model: id }); if (typeof client === "string") throw new Error(client); return client; },
    requestApproval: denyApprovals(io),
    session,
    history,
    ...(config.mode === "approval" || config.mode === "assist" || config.mode === "full" ? { accessMode: config.mode } : {}),
    ...(selection ? { modelId: selection.model.id } : {}),
  });
  registerTools(ringko, config, workspace, session);

  try {
    const result = await ringko.run(prompt);
    io.out(result.content);
    io.err(`session ${session.id}`);
    return 0;
  } finally {
    session.close();
  }
}

async function tuiCommand(parsed: ParsedArgs, io: CliIo): Promise<number> {
  if (!process.stdout.isTTY) {
    io.err("ringko tui requires an interactive terminal.");
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
  const resumeSessionId = parsed.session ?? (parsed.resume ? store.list()[0]?.id : undefined);
  const resumedModel = resumeSessionId ? sessionModel(store.open(resumeSessionId, "read").all()) : undefined;
  const chosen = hasOverride ? undefined : resumedModel ?? latestSessionModel(store) ?? config.model;
  const prioritized: RingkoConfig = chosen ? { ...config, model: chosen } : config;

  const model = await loadProviderModel(prioritized, override);
  if (typeof model === "string") {
    io.err(model);
    return 1;
  }
  const selection = selectModel(prioritized, override);
  const modelLabel = selectionLabel(selection);

  let smallModel: import("@ringko-ai/sdk").ModelClient | undefined;
  if (config.small_model) {
    const built = await loadProviderModel({ ...config, model: config.small_model });
    if (typeof built === "function") smallModel = built;
  }

  let repl: ReplModule;
  try {
    repl = (await import("@ringko-ai/repl")) as ReplModule;
  } catch (error) {
    io.err(`Cannot load @ringko-ai/repl: ${(error as Error).message}`);
    return 1;
  }
  const sessionId = await repl.launchRepl({
    model,
    modelLabel,
    config,
    workspace,
    createModel: (nextConfig) => loadProviderModel(nextConfig),
    ...(resumeSessionId ? { resumeSessionId } : {}),
    ...(parsed.sessionPicker ? { pickSession: true } : {}),
    ...(selection ? { modelId: selection.model.id } : {}),
    ...(smallModel ? { smallModel } : {}),
  });
  if (sessionId) io.err(`session ${sessionId}`);
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
  if (value === "google" || value === "gemini" || value === "google-oauth") return "google-gemini-cli";
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
      if (domain !== "openai-oauth" && domain !== "github-copilot" && domain !== "xai-oauth" && domain !== "anthropic-oauth" && domain !== "google-gemini-cli") {
        io.err(`Unsupported OAuth domain "${domain}" (supported: openai-oauth, github-copilot, xai-oauth, anthropic-oauth, google-gemini-cli).`);
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
              : domain === "google-gemini-cli"
                ? await loginGoogle(url => { io.out("open this URL to sign in:"); io.out(url); openBrowser(url) }, process.env.GOOGLE_CLOUD_PROJECT)
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
        await syncModels(domain === "github-copilot" ? "github-copilot" : domain === "xai-oauth" ? "xai" : domain === "anthropic-oauth" ? "anthropic" : domain === "google-gemini-cli" ? "google-gemini-cli" : "openai", domain, io);
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
