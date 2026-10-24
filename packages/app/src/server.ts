// Local HTTP + SSE server backing the WebUI. It exposes the harness over a
// small REST surface: info, sessions, a streaming chat endpoint, and a tool
// approval endpoint. Static assets from @ringko-ai/webui are served as well.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import {
  loginAnthropic,
  loginGitHubCopilot,
  loginOpenAiDevice,
  loginXaiDevice,
  queryCodexQuota,
  queryXaiQuota,
  refreshOpenAi,
  refreshXai,
} from "@ringko-ai/auth";
import {
  createRingKo,
  access,
  estimateMessagesTokens,
  estimateToolsTokens,
  generateSessionMeta,
  isAccessMode,
  loopPrompt,
  parseLoopArgs,
  promiseText,
  type ChatMessage,
  type LoopOptions,
  type RingKo,
} from "@ringko-ai/sdk";
import {
  AskManager,
  createShellTool,
  type AskHandler,
} from "@ringko-ai/tools";
import {
  createSkill,
  configuredModelIds,
  discoverSkills,
  getOAuthAccount,
  getToolAuth,
  loadAuth,
  loadConfig,
  loadMcpServerMap,
  loadMcpServers,
  loadProjects,
  loadProviders,
  knownModels,
  modelLabel,
  OAUTH_DOMAINS,
  PROVIDER_PRESETS,
  removeOAuthAccount,
  removeSkill,
  saveMcpServers,
  saveProjectMcpServers,
  saveProviders,
  saveProjects,
  saveSettings,
  saveConfigFile,
  setDefaultOAuthAccount,
  setOAuthAccount,
  setToolAuth,
  updateOAuthCredential,
  writeDiagnostic,
  type McpServerConfig,
  type ModelDefinition,
  type OAuthAccount,
  type ProviderDefinition,
  type RingkoConfig,
} from "@ringko-ai/config";
import {
  authorizeMcpServer,
  openMcpServer,
  type McpConnection,
} from "@ringko-ai/mcp";
import { listWorkflows, resolveWorkflow } from "@ringko-ai/workflow";
import { EventLog, createTimeSource } from "@ringko-ai/runtime";
import {
  SessionStore,
  forkSession,
  recordFeedback,
  recordSessionArchived,
  recordSessionTitle,
  recordUserMessage,
  recordAssistantMessage,
  recordSessionModel,
  recordSessionThinking,
  recordToolCall,
  recordToolResult,
  sessionArchived,
  sessionFeedback,
  sessionSummary,
  sessionTitle,
  toolLogEntries,
  trajectoryPage,
  taskSummaries,
  sessionTodos,
  sessionJobs,
  toChatMessages,
  type FeedbackValue,
  type SessionEvent,
  type SessionHandle,
} from "@ringko-ai/session";
import { loadModel } from "./model.ts";
import { WorkspaceReview } from "./workspace-review.ts";
import { RuntimeManager, registerRuntimeTools, type RuntimeAgent } from "@ringko-ai/sdk/runtime";
import { PROTOCOL_VERSION } from "@ringko-ai/protocol";
import { SyncManager } from "./services/sync.ts";
import { RunStateManager } from "./services/runs.ts";

export interface ServerOptions {
  port?: number;
  host?: string;
  workspace?: string;
  /** Directory of built WebUI assets (defaults to ../webui/dist). */
  webuiDir?: string;
  configPath?: string;
  /**
   * Dev mode: proxy non-`/api` requests to a Vite dev server so a single URL
   * serves the UI (with HMR) and the API.
   */
  devServerUrl?: string;
  /**
   * Optional API token (`RINGKO_WEB_TOKEN`). When set, every `/api/*` request
   * except `/api/info` must send `Authorization: Bearer <token>`. Unset means
   * the server is unauthenticated.
   */
  authToken?: string;
  /** Auto-shared services stay pinned to one workspace; clients never silently switch tools' cwd. */
  shared?: boolean;
}

export interface RingkoServer {
  readonly url: string;
  readonly port: number;
  stop(): void;
}

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_WEBUI_DIR = resolve(import.meta.dir, "../../webui/dist");
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_JSON_BYTES = 1_048_576;
const MAX_ACTIVE_RUNS = 8;
const META_TIMEOUT_MS = 30_000;
const MAX_TERMINAL_SESSIONS = 4;
const TERMINAL_SESSION_TTL_MS = 30 * 60 * 1000;

interface TerminalSocketData {
  terminalId: string;
}

interface TerminalSession {
  terminal: InteractiveTerminal;
  socket?: Bun.ServerWebSocket<TerminalSocketData>;
  exited: boolean;
  pendingOutput: string;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

interface InteractiveTerminal {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(handler: (data: string) => void): void;
  onError(handler: (message: string) => void): void;
  onExit(handler: (event: { exitCode: number; signal?: number }) => void): void;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function registerTools(
  ringko: RingKo,
  config: RingkoConfig,
  workspace: string,
): void {
  registerRuntimeTools(ringko, config, workspace);
}

async function readJson<T>(request: Request): Promise<T | undefined> {
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  try {
    const chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_JSON_BYTES) { await reader.cancel(); return undefined; }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    return undefined;
  } finally { reader.releaseLock(); }
}

/** Start the local server. Throws if the port is unavailable. */
export function startServer(options: ServerOptions = {}): RingkoServer {
  const host = options.host ?? process.env.RINGKO_HOST ?? DEFAULT_HOST;
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(host);
  if (options.shared && !loopback) throw new Error("Shared backends only support loopback hosts. Unset RINGKO_HOST or use 127.0.0.1.");
  const configuredPort = Number(process.env.RINGKO_PORT);
  const port = options.port ?? (Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : DEFAULT_PORT);
  let workspace = resolve(options.workspace ?? process.cwd());
  const bundledWebuiDir = resolve(import.meta.dir, "../webui");
  const webuiDir = resolve(options.webuiDir ?? process.env.RINGKO_WEBUI_DIR ?? (existsSync(join(DEFAULT_WEBUI_DIR, "index.html")) ? DEFAULT_WEBUI_DIR : existsSync(join(bundledWebuiDir, "index.html")) ? bundledWebuiDir : join(dirname(process.execPath), "webui")));
  let store = new SessionStore({ cwd: workspace });
  const approvals = new Map<string, (approved: boolean, scope?: "session" | "saved") => void>();
  const questions = new Map<string, AskManager>();
  const activeAgents = new Map<string, RingKo>();
  const activeRuns = new Map<string, AbortController>();
  const activeHandles = new Map<string, SessionHandle>();
  const sync = new SyncManager();
  const runStates = new RunStateManager();
  // Single-threaded reservation: persistence validation and ownership happen without an await boundary.
  function beginRun(session: SessionHandle, record: () => void): AbortController {
    try { record(); session.flush(); }
    catch (error) {
      try { session.close(); } catch (failure) { writeDiagnostic("session.close", String(failure)); }
      throw error;
    }
    const controller = new AbortController();
    activeRuns.set(session.id, controller); activeHandles.set(session.id, session); runStates.begin(session.id);
    writeDiagnostic("backend.run.start", JSON.stringify({ sessionId: session.id }));
    sync.publish("session", session.id);
    return controller;
  }
  const terminalSessions = new Map<string, TerminalSession>();
  const baseWorkspace = workspace;
  let projects = (() => {
    try {
      return loadProjects();
    } catch {
      return { projects: [] };
    }
  })();
  // Start in the active project's workspace when one is registered and exists.
  const activeProject = projects.current ? projects.projects.find((entry) => entry.id === projects.current) : undefined;
  if (activeProject && !options.shared && !options.workspace) {
    try {
      if (statSync(activeProject.path).isDirectory()) workspace = resolve(activeProject.path);
    } catch {
      // Registered project is gone; keep the launch directory.
    }
  }
  store = new SessionStore({ cwd: workspace });

  function activateProject(id: string | undefined): void {
    if (options.shared) throw new Error("This shared backend is pinned to its workspace. Start a client in the other workspace instead.");
    if (activeRuns.size) throw new Error("Cannot switch workspace while sessions are running.");
    projects = id ? { projects: projects.projects, current: id } : { projects: projects.projects };
    saveProjects(projects);
    const active = id ? projects.projects.find((entry) => entry.id === id) : undefined;
    workspace = active ? resolve(active.path) : baseWorkspace;
    store = new SessionStore({ cwd: workspace });
    resetMcp();
    sync.publish("workspace");
  }

  // Connected MCP servers for the active workspace (lazily established, cached).
  const runtimes = new Map<string, RuntimeManager>();
  function runtimeFor(cwd: string): RuntimeManager {
    const path = resolve(cwd);
    let runtime = runtimes.get(path);
    if (!runtime) { runtime = new RuntimeManager(path, eventLog); runtimes.set(path, runtime); }
    return runtime;
  }

  async function mcpConnections(cwd: string): Promise<{ connections: McpConnection[]; errors: { name: string; message: string }[] }> {
    return await runtimeFor(cwd).connections();
  }

  function resetMcp(): void {
    for (const runtime of runtimes.values()) void runtime.resetMcp().catch(() => {});
  }

  // Runtime event log + a time source; the model watches them via `subscribe`.
  const eventLog = new EventLog();
  const stopTimeSource = createTimeSource(eventLog, { intervalMs: 60_000 });
  void runtimeFor(workspace).start().catch(error => writeDiagnostic("mcp.start", String(error)));

  function readConfig(): RingkoConfig | string {
    try {
      return loadConfig({ path: options.configPath });
    } catch (error) {
      return error instanceof Error ? error.message : "Invalid configuration.";
    }
  }

  async function handleInfo(): Promise<Response> {
    const config = readConfig();
    if (typeof config === "string") return json({ error: config }, 500);
    const model = await loadModel(config);
    const tools = createRingKo({ task: true, log: eventLog, model: async () => ({ content: "", toolCalls: [] }) });
    registerTools(tools, config, workspace);
    const accessMode = isAccessMode(config.permission)
      ? config.permission
      : isAccessMode(config.mode)
        ? config.mode
        : "approval";
    const workflow = resolveWorkflow(config.workflow);
    const activeId = projects.current;
    const active = activeId ? projects.projects.find((entry) => entry.id === activeId) : undefined;
    return json({
      backend: { protocol: PROTOCOL_VERSION, instance: sync.instance },
      workspace,
      project: active ? { id: active.id, name: active.name } : null,
      auth: { required: Boolean(options.authToken) },
      access: access(accessMode),
      accessMode,
      permission: accessMode,
      mode: { id: workflow.id, label: workflow.label ?? workflow.id, description: workflow.description ?? null },
      workflows: listWorkflows().map((entry) => ({
        id: entry.id,
        label: entry.label ?? entry.id,
        description: entry.description ?? null,
      })),
      context: {
        used: estimateToolsTokens(tools.tools.list()),
        limit: typeof model === "string" ? 128_000 : (model.selection.model.maxInputTokens ?? 128_000),
      },
      thinking: config.thinking ?? null,
      expandThinking: config.expandThinking ?? false,
      expandTools: config.expandTools ?? false,
      model: typeof model === "string" ? null : modelLabel(model.selection),
      modelId:
        typeof model === "string" ? null : `${model.selection.provider.name}/${model.selection.model.id}`,
      providers: (config.providers ?? []).map((provider) => ({
        name: provider.name,
        type: provider.type ?? provider.vendor ?? null,
        models: (provider.models ?? []).map((entry) => entry.id),
      })),
      tools: tools.tools.list().map((tool) => tool.name),
    });
  }

  function handleProjects(): Response {
    const current = projects.current ?? null;
    const active = current ? projects.projects.find((entry) => entry.id === current) : undefined;
    return json({
      projects: projects.projects,
      current,
      workspace,
      project: active ? { id: active.id, name: active.name } : null,
    });
  }

  async function handleAddProject(request: Request): Promise<Response> {
    const body = await readJson<{ path?: unknown; name?: unknown }>(request);
    const raw = typeof body?.path === "string" ? body.path.trim() : "";
    if (raw.length === 0) return json({ error: "path is required." }, 400);
    const target = resolve(raw);
    try {
      if (!statSync(target).isDirectory()) return json({ error: "path is not a directory." }, 400);
    } catch {
      return json({ error: "path does not exist." }, 400);
    }
    const existing = projects.projects.find((entry) => resolve(entry.path) === target);
    if (!existing) {
      const id = `proj-${randomUUID().slice(0, 8)}`;
      const name = typeof body?.name === "string" && body.name.trim().length > 0 ? body.name.trim() : basename(target);
      projects = { projects: [...projects.projects, { id, name, path: target }], ...(projects.current ? { current: projects.current } : {}) };
      if (!projects.current) {
        activateProject(id);
        return handleProjects();
      }
      saveProjects(projects);
    }
    return handleProjects();
  }

  const LIST_LIMIT = 2000;

  function crumbsFor(target: string): { name: string; path: string }[] {
    const crumbs: { name: string; path: string }[] = [];
    let current = resolve(target);
    for (;;) {
      const parent = dirname(current);
      crumbs.unshift({ name: basename(current) || current, path: current });
      if (parent === current) break;
      current = parent;
    }
    return crumbs;
  }

  /** List the child directories of a level (default: the user home directory). */
  function handleListDirectory(url: URL): Response {
    const home = homedir();
    const requested = url.searchParams.get("path");
    const target = requested && requested.trim().length > 0 ? resolve(requested) : home;
    let dirents;
    try {
      dirents = readdirSync(target, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return json({ error: code === "ENOENT" ? "Directory not found." : "Cannot read this directory." }, 400);
    }
    const entries = dirents
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: entry.name, path: join(target, entry.name), hidden: entry.name.startsWith(".") }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return json({
      path: target,
      home,
      separator: sep,
      crumbs: crumbsFor(target),
      entries: entries.slice(0, LIST_LIMIT),
      truncated: entries.length > LIST_LIMIT,
    });
  }

  async function handleCreateDirectory(request: Request): Promise<Response> {
    const body = await readJson<{ path?: unknown; name?: unknown }>(request);
    const parent = typeof body?.path === "string" ? body.path.trim() : "";
    const name = typeof body?.name === "string" ? body.name : "";
    if (parent.length === 0) return json({ error: "path is required." }, 400);
    if (name.trim().length === 0 || name.includes("/") || name.includes("\\")) {
      return json({ error: "name must be a single folder name." }, 400);
    }
    const target = join(resolve(parent), name);
    try {
      mkdirSync(target, { recursive: false });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return json({ error: code === "EEXIST" ? "A folder with that name already exists." : "Cannot create folder." }, 400);
    }
    return json({ path: target });
  }

  function handleRemoveProject(id: string): Response {
    const remaining = projects.projects.filter((entry) => entry.id !== id);
    if (remaining.length === projects.projects.length) return json({ error: "Unknown project." }, 404);
    const wasCurrent = projects.current === id;
    projects = { projects: remaining, ...(wasCurrent ? {} : projects.current ? { current: projects.current } : {}) };
    if (wasCurrent) {
      activateProject(undefined);
    } else {
      saveProjects(projects);
    }
    return handleProjects();
  }

  function handleSetCurrentProject(id: string): Response {
    if (!projects.projects.some((entry) => entry.id === id)) return json({ error: "Unknown project." }, 404);
    activateProject(id);
    return handleProjects();
  }

  function mcpPayload(): Record<string, unknown> {
    return {
      servers: loadMcpServers({ cwd: workspace }).map((server) => ({
        name: server.name,
        source: server.source,
        scope: server.scope,
        kind: server.config.url ? "http" : "stdio",
        authenticated: Boolean(getToolAuth(server.name)),
        config: server.config,
      })),
      map: loadMcpServerMap(),
    };
  }

  function handleMcp(): Response {
    try {
      return json(mcpPayload());
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Invalid MCP configuration." }, 500);
    }
  }

  async function handleSaveMcp(request: Request): Promise<Response> {
    const body = await readJson<{ servers?: unknown; scope?: unknown }>(request);
    if (typeof body?.servers !== "object" || body.servers === null || Array.isArray(body.servers)) {
      return json({ error: "servers must be an object." }, 400);
    }
    const scope = body.scope === "project" ? "project" : "global";
    const servers: Record<string, McpServerConfig> = {};
    for (const [name, config] of Object.entries(body.servers as Record<string, unknown>)) {
      if (name.trim().length === 0 || typeof config !== "object" || config === null || Array.isArray(config)) {
        return json({ error: `invalid MCP server "${name}".` }, 400);
      }
      servers[name] = config as McpServerConfig;
    }
    try {
      if (scope === "project") saveProjectMcpServers(workspace, servers);
      else saveMcpServers(servers);
      resetMcp();
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Cannot save MCP configuration." }, 500);
    }
    return handleMcp();
  }

  async function handleMcpConnected(): Promise<Response> {
    const mcp = await mcpConnections(workspace);
    return json({
      servers: mcp.connections.map((connection) => ({
        name: connection.name,
        serverInfo: connection.serverInfo,
        tools: connection.tools.map((tool) => ({ name: tool.name, description: tool.description ?? null })),
      })),
      errors: mcp.errors,
    });
  }

  async function handleMcpTest(request: Request): Promise<Response> {
    const body = await readJson<{ name?: unknown; config?: unknown }>(request);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (name.length === 0 || typeof body?.config !== "object" || body.config === null || Array.isArray(body.config)) {
      return json({ error: "name and config are required." }, 400);
    }
    try {
      const connection = await openMcpServer(name, body.config as McpServerConfig);
      const tools = connection.tools.map((tool) => ({ name: tool.name, description: tool.description ?? null }));
      const serverInfo = connection.serverInfo;
      await connection.client.close().catch(() => {});
      return json({ serverInfo, tools });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "MCP connection failed." }, 502);
    }
  }

  /** Start the OAuth loopback flow for a remote MCP server (e.g. Cloudflare). */
  async function handleMcpOAuth(request: Request): Promise<Response> {
    const now = Date.now();
    pruneOAuthFlows(now);
    const body = await readJson<{ name?: unknown; url?: unknown }>(request);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    if (name.length === 0 || url.length === 0) return json({ error: "name and url are required." }, 400);

    const id = randomUUID();
    oauthFlows.set(id, { status: "pending", createdAt: now });
    let resolveIssued: ((value: { url: string }) => void) | undefined;
    const issued = new Promise<{ url: string }>((resolve) => {
      resolveIssued = resolve;
    });
    const outcome = authorizeMcpServer(url, (authUrl) => resolveIssued?.({ url: authUrl })).then(
      (credential) => {
        setToolAuth(name, credential);
        oauthFlows.set(id, { status: "success", createdAt: now });
        resetMcp();
        return undefined;
      },
    ).catch(
      (error: unknown) => {
        const message = error instanceof Error ? error.message : "MCP authorization failed.";
        oauthFlows.set(id, { status: "error", error: message, createdAt: now });
        return message;
      },
    );
    const ready = await Promise.race([
      issued.then((value) => ({ ok: true as const, ...value })),
      outcome.then((failure) => (failure === undefined ? undefined : { ok: false as const, error: failure })),
    ]);
    if (!ready || !ready.ok) {
      return json({ error: ready && !ready.ok ? ready.error : "MCP authorization failed before the URL was issued." }, 502);
    }
    return json({ flowId: id, verificationUrl: ready.url, userCode: "" });
  }

  function handleSkills(): Response {
    return json(discoverSkills({ cwd: workspace }).map((skill) => ({ ...skill })));
  }

  async function handleCreateSkill(request: Request): Promise<Response> {
    const body = await readJson<{ name?: unknown; description?: unknown; body?: unknown }>(request);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (name.length === 0) return json({ error: "name is required." }, 400);
    try {
      createSkill({
        name,
        ...(typeof body?.description === "string" ? { description: body.description } : {}),
        ...(typeof body?.body === "string" ? { body: body.body } : {}),
      });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Cannot create skill." }, 400);
    }
    return handleSkills();
  }

  async function handleRemoveSkill(request: Request): Promise<Response> {
    const body = await readJson<{ dir?: unknown }>(request);
    const dir = typeof body?.dir === "string" ? body.dir : "";
    if (dir.length === 0) return json({ error: "dir is required." }, 400);
    try {
      if (!removeSkill(dir, process.env, workspace)) return json({ error: "Unknown skill directory." }, 404);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Cannot remove skill." }, 400);
    }
    return handleSkills();
  }

  function handleProviders(): Response {
    try {
      return json(loadProviders());
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Invalid provider file." }, 500);
    }
  }

  async function handleSaveProviders(request: Request): Promise<Response> {
    const body = await readJson<{ model?: unknown; small_model?: unknown; providers?: unknown }>(request);
    if (!body || !Array.isArray(body.providers)) return json({ error: "providers must be an array." }, 400);
    const providers: ProviderDefinition[] = [];
    for (const entry of body.providers) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return json({ error: "each provider must be an object." }, 400);
      }
      const record = entry as Record<string, unknown>;
      if (typeof record.name !== "string" || record.name.trim().length === 0) {
        return json({ error: "provider.name is required." }, 400);
      }
      if (record.models !== undefined && !Array.isArray(record.models)) {
        return json({ error: `provider "${record.name}": models must be an array.` }, 400);
      }
      const provider: ProviderDefinition = { name: record.name };
      if (typeof record.type === "string") provider.type = record.type;
      if (typeof record.vendor === "string") provider.vendor = record.vendor;
      if (typeof record.baseURL === "string") provider.baseURL = record.baseURL;
      if (typeof record.url === "string") provider.url = record.url;
      if (typeof record.apiKey === "string") provider.apiKey = record.apiKey;
      if (typeof record.module === "string") provider.module = record.module;
      if (Array.isArray(record.models)) provider.models = record.models as ModelDefinition[];
      providers.push(provider);
    }
    try {
      saveProviders({
        providers,
        ...(typeof body.model === "string" ? { model: body.model } : {}),
        ...(typeof body.small_model === "string" ? { small_model: body.small_model } : {}),
      });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Cannot save providers." }, 500);
    }
    return await handleInfo();
  }

  // OAuth device-code flows in flight, keyed by a flow id the WebUI polls.
  const oauthFlows = new Map<string, { status: "pending" | "success" | "error"; error?: string; createdAt: number }>();
  const OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;
  const OAUTH_ISSUE_TIMEOUT_MS = 30 * 1000;

  /** Map an auth domain to the OAuth flow it speaks, if any. */
  function oauthKind(domain: string): "openai" | "copilot" | "xai" | "anthropic" | undefined {
    if (domain === "openai-oauth") return "openai";
    if (domain === "github-copilot") return "copilot";
    if (domain === "xai-oauth") return "xai";
    if (domain === "anthropic-oauth") return "anthropic";
    return undefined;
  }

  function pruneOAuthFlows(now: number): void {
    for (const [id, flow] of oauthFlows) {
      if (now - flow.createdAt > OAUTH_FLOW_TTL_MS) oauthFlows.delete(id);
    }
  }

  /** Account states only; token material never leaves the server. */
  function handleAuth(): Response {
    const state = loadAuth();
    const domains = OAUTH_DOMAINS;
    return json({
      domains: domains.map((domain) => {
        const entry = state.oauth[domain] ?? { accounts: [] };
        const defaultAccountId = entry.defaultAccountId ?? entry.accounts[0]?.id;
        return {
          domain,
          defaultAccountId: defaultAccountId ?? null,
          accounts: entry.accounts.map((account: OAuthAccount) => ({
            id: account.id,
            uuid: account.uuid ?? account.id,
            login: account.credential.login ?? "",
            avatarUrl: account.credential.avatarUrl ?? null,
            authenticatedAt: account.authenticatedAt,
            isDefault: defaultAccountId === account.id,
            reauthRequired: domain === "openai-oauth" && account.credential.accountId === undefined,
          })),
        };
      }),
    });
  }

  async function handleSetDefaultAuth(request: Request): Promise<Response> {
    const body = await readJson<{ domain?: unknown; accountId?: unknown }>(request);
    const domain = typeof body?.domain === "string" ? body.domain.trim() : "";
    const accountId = typeof body?.accountId === "string" ? body.accountId.trim() : "";
    if (domain.length === 0 || accountId.length === 0) {
      return json({ error: "domain and accountId are required." }, 400);
    }
    setDefaultOAuthAccount(domain, accountId);
    return handleAuth();
  }

  async function handleRemoveAuthAccount(request: Request): Promise<Response> {
    const body = await readJson<{ domain?: unknown; accountId?: unknown }>(request);
    const domain = typeof body?.domain === "string" ? body.domain.trim() : "";
    const accountId = typeof body?.accountId === "string" ? body.accountId.trim() : "";
    if (domain.length === 0 || accountId.length === 0) {
      return json({ error: "domain and accountId are required." }, 400);
    }
    removeOAuthAccount(domain, accountId);
    return handleAuth();
  }

  async function handleStartOAuth(request: Request): Promise<Response> {
    const now = Date.now();
    pruneOAuthFlows(now);
    const body = await readJson<{ domain?: unknown }>(request);
    const domain = typeof body?.domain === "string" ? body.domain.trim() : "";
    if (domain.length === 0) return json({ error: "domain is required." }, 400);
    const kind = oauthKind(domain);
    if (!kind) return json({ error: `Unsupported OAuth domain "${domain}".` }, 400);
    if ([...oauthFlows.values()].filter(flow => flow.status === "pending").length >= 4 || oauthFlows.size >= 64) return json({ error: "Too many sign-in attempts. Finish an existing attempt or retry later." }, 429);

    const id = randomUUID();
    oauthFlows.set(id, { status: "pending", createdAt: now });
    let resolveIssued: ((value: { url: string; code: string }) => void) | undefined;
    const onCode = (url: string, code: string): void => resolveIssued?.({ url, code });
    const login = kind === "openai"
      ? loginOpenAiDevice(onCode)
      : kind === "copilot"
        ? loginGitHubCopilot(onCode)
        : kind === "anthropic"
          ? loginAnthropic((url) => onCode(url, ""))
          : loginXaiDevice(onCode);
    const outcome = login.then(
      (credential) => {
        const accountId = credential.accountId ?? credential.login ?? randomUUID();
        setOAuthAccount(domain, { id: accountId, credential, authenticatedAt: Date.now() });
        oauthFlows.set(id, { status: "success", createdAt: now });
        return undefined;
      },
    ).catch(
      (error: unknown) => {
        const message = error instanceof Error ? error.message : "OAuth login failed.";
        oauthFlows.set(id, { status: "error", error: message, createdAt: now });
        return message;
      },
    );
    // Device flows call `onCode` after their start request; wait for that (or the
    // flow's own failure) so the browser can show the code as soon as it exists.
    const ready = await new Promise<{ url: string; code: string } | string>((resolve) => {
      const timer = setTimeout(() => resolve("OAuth start timed out."), OAUTH_ISSUE_TIMEOUT_MS);
      timer.unref?.();
      resolveIssued = (value) => {
        clearTimeout(timer);
        resolve(value);
      };
      void outcome.then((failure) => {
        if (failure === undefined) return;
        clearTimeout(timer);
        resolve(failure);
      });
    });
    if (typeof ready === "string") return json({ error: ready }, 502);
    return json({ flowId: id, verificationUrl: ready.url, userCode: ready.code });
  }

  function handleOAuthStatus(id: string): Response {
    const flow = oauthFlows.get(id);
    if (!flow) return json({ error: "Unknown OAuth flow." }, 404);
    return json({ status: flow.status, ...(flow.error ? { error: flow.error } : {}) });
  }

  /** Query the subscription/usage windows for one OAuth account. */
  async function handleAuthQuota(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const domain = (params.get("domain") ?? "").trim();
    const accountId = (params.get("accountId") ?? "").trim() || undefined;
    if (domain !== "openai-oauth" && domain !== "xai-oauth") {
      return json({ error: "Quota is only available for openai-oauth and xai-oauth." }, 400);
    }
    const account = getOAuthAccount(domain, accountId);
    if (!account) return json({ error: "No account for this domain." }, 404);
    try {
      let credential = account.credential;
      if (credential.expires <= Date.now() + 60_000) {
        credential = domain === "xai-oauth"
          ? await refreshXai(credential.refresh)
          : await refreshOpenAi(credential.refresh);
        updateOAuthCredential(domain, account.id, credential);
      }
      const quota = domain === "xai-oauth"
        ? await queryXaiQuota(credential.access, credential.accountId)
        : await queryCodexQuota(credential.access, credential.accountId);
      return json(quota);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Quota query failed." }, 502);
    }
  }

  /** Get a session's ratings keyed by transcript message index. */
  function handleGetFeedback(id: string): Response {
    try {
      return json(sessionFeedback(store.open(id, "read").all()));
    } catch {
      return json({ error: "Unknown session." }, 404);
    }
  }

  /** Set or clear the rating for one transcript message. */
  async function handleSetFeedback(id: string, request: Request): Promise<Response> {
    const body = await readJson<{ index?: unknown; value?: unknown }>(request);
    if (typeof body?.index !== "number" || !Number.isInteger(body.index) || body.index < 0) {
      return json({ error: "Invalid index." }, 400);
    }
    const value = body.value;
    if (value !== "up" && value !== "down" && value !== null && value !== undefined) {
      return json({ error: "Invalid value." }, 400);
    }
    let handle: SessionHandle;
    try {
      handle = store.open(id, "write");
    } catch {
      return json({ error: "Unknown session." }, 404);
    }
    try {
      recordFeedback(handle, body.index, (value ?? null) as FeedbackValue | null);
      handle.flush();
    } finally {
      handle.close();
    }
    return json({ ok: true });
  }

  /** Fork a session: copy the event prefix up to a message index into a child session. */
  async function handleForkSession(id: string, request: Request): Promise<Response> {
    try {
      store.open(id, "read");
    } catch {
      return json({ error: "Unknown session." }, 404);
    }
    const body = await readJson<{ index?: unknown }>(request);
    const index = typeof body?.index === "number" && Number.isInteger(body.index) && body.index >= 0 ? body.index : undefined;
    try {
      return json({ sessionId: forkSession(store, id, { cwd: workspace, index }) });
    } catch (error) {
      if (error instanceof Error && error.message === "Nothing to branch.") return json({ error: "Nothing to branch." }, 400);
      return json({ error: "Could not fork session." }, 500);
    }
  }


  function persistSettings(config: RingkoConfig): void {
    if (options.configPath) saveConfigFile(config, options.configPath);
    else saveSettings(config);
  }

  async function handleSetAccess(request: Request): Promise<Response> {
    const body = await readJson<{ mode?: unknown; permission?: unknown }>(request);
    const permission = body?.permission ?? body?.mode;
    if (!isAccessMode(permission)) {
      return json({ error: 'permission must be "approval" | "assist" | "full".' }, 400);
    }
    const config = readConfig();
    if (typeof config === "string") return json({ error: config }, 500);
    persistSettings({ ...config, permission, mode: permission });
    return await handleInfo();
  }

  async function handleSetMode(request: Request): Promise<Response> {
    const body = await readJson<{ workflow?: unknown; mode?: unknown }>(request);
    const workflow = typeof (body?.workflow ?? body?.mode) === "string" ? String(body?.workflow ?? body?.mode).trim() : "";
    if (workflow.length === 0) return json({ error: "workflow is required." }, 400);
    const config = readConfig();
    if (typeof config === "string") return json({ error: config }, 500);
    persistSettings({ ...config, workflow });
    return await handleInfo();
  }

  async function handleUpload(request: Request): Promise<Response> {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: "expected multipart/form-data." }, 400);
    }
    const files = form.getAll("file").filter((value): value is File => value instanceof File);
    if (files.length === 0) return json({ error: "no files." }, 400);
    const dir = join(workspace, ".ringko", "uploads");
    mkdirSync(dir, { recursive: true });
    const saved: { name: string; path: string }[] = [];
    for (const file of files) {
      const safe = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
      const stored = `${Date.now()}-${safe}`;
      await Bun.write(join(dir, stored), file);
      saved.push({ name: file.name, path: `.ringko/uploads/${stored}` });
    }
    return json({ files: saved });
  }

  async function handleSetThinking(request: Request): Promise<Response> {
    const body = await readJson<{ level?: unknown }>(request);
    const level = typeof body?.level === "string" ? body.level.trim().toLowerCase() : "";
    if (!["off", "low", "high", "max"].includes(level)) {
      return json({ error: 'level must be "off" | "low" | "high" | "max".' }, 400);
    }
    const config = readConfig();
    if (typeof config === "string") return json({ error: config }, 500);
    persistSettings({ ...config, thinking: level });
    return await handleInfo();
  }

  async function handleSetUi(request: Request): Promise<Response> {
    const body = await readJson<{ expandThinking?: unknown; expandTools?: unknown }>(request);
    const config = readConfig();
    if (typeof config === "string") return json({ error: config }, 500);
    const next: RingkoConfig = { ...config };
    if (typeof body?.expandThinking === "boolean") next.expandThinking = body.expandThinking;
    if (typeof body?.expandTools === "boolean") next.expandTools = body.expandTools;
    persistSettings(next);
    return await handleInfo();
  }

  async function handleCompact(request: Request): Promise<Response> {
    const body = await readJson<{ sessionId?: unknown; instructions?: unknown }>(request);
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
    if (sessionId.length === 0) return json({ error: "sessionId is required." }, 400);
    if (activeRuns.has(sessionId)) return json({ error: "Session is busy." }, 409);
    const config = readConfig();
    if (typeof config === "string") return json({ error: config }, 500);
    const model = await loadModel(config);
    if (typeof model === "string") return json({ error: model }, 400);
    const small = config.small_model ? await loadModel({ ...config, model: config.small_model }) : undefined;
    let session: SessionHandle;
    let history: ChatMessage[] = [];
    try {
      if (activeRuns.has(sessionId)) return json({ error: "Session is busy." }, 409);
      history = toChatMessages(store.open(sessionId, "read").all());
      session = store.open(sessionId, "write");
    } catch {
      return json({ error: "Unknown session." }, 404);
    }
    try {
      const ringko = createRingKo({
        model: model.client,
        session,
        history,
        modelId: model.selection.model.id,
        ...(small && typeof small !== "string" ? { smallModel: small.client } : {}),
        ...(model.selection.model.maxInputTokens ? { contextWindow: model.selection.model.maxInputTokens } : {}),
        ...(model.selection.model.maxOutputTokens ? { reserveOutputTokens: model.selection.model.maxOutputTokens } : {}),
        ...(config.compaction ? { compaction: config.compaction } : {}),
      });
      const result = await ringko.compact(typeof body?.instructions === "string" ? body.instructions : undefined);
      return json({ compacted: result.compacted, summary: result.summary ?? null, tokens: ringko.tokens() });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Compaction failed." }, 500);
    } finally {
      session.close();
    }
  }

  async function handleSetModel(request: Request): Promise<Response> {
    const body = await readJson<{ model?: unknown }>(request);
    const target = typeof body?.model === "string" ? body.model.trim() : "";
    const slash = target.indexOf("/");
    if (slash <= 0 || slash === target.length - 1) {
      return json({ error: "model must be \"<provider>/<model-id>\"." }, 400);
    }
    const config = readConfig();
    if (typeof config === "string") return json({ error: config }, 500);
    const providerName = target.slice(0, slash);
    const modelId = target.slice(slash + 1);
    const provider = (config.providers ?? []).find((entry) => entry.name === providerName);
    if (!provider) return json({ error: `unknown provider "${providerName}".` }, 400);
    if (!(provider.models ?? []).some((entry) => entry.id === modelId)) {
      return json({ error: `unknown model "${modelId}" for provider "${providerName}".` }, 400);
    }
    if (options.configPath) saveConfigFile({ ...config, model: target }, options.configPath);
    else saveProviders({ ...loadProviders(), model: target });
    return await handleInfo();
  }

  /** A session's title, or its first user message truncated as a fallback. */
  function sessionTitleView(events: readonly SessionEvent[]): string | null {
    const recorded = sessionTitle(events);
    if (recorded && recorded.trim().length > 0) return recorded;
    const firstUser = toChatMessages(events).find((message) => message.role === "user");
    const text = firstUser?.content.trim();
    return text && text.length > 0 ? text.slice(0, 60) : null;
  }

  function handleSessions(): Response {
    return json(
      store.list().map((meta) => {
        let title: string | null = null;
        let summary: string | null = null;
        let archived = false;
        try {
          const events = store.open(meta.id, "read").all();
          title = sessionTitleView(events);
          summary = sessionSummary(events) ?? null;
          archived = sessionArchived(events);
        } catch {
          // unreadable session log: report it without a label
        }
        return { id: meta.id, createdAt: meta.header.createdAt, cwd: meta.header.cwd ?? null, title, summary, archived, ...(activeRuns.has(meta.id) ? { busy: true } : {}) };
      }),
    );
  }

  function handleCreateSession(): Response {
    const session = store.create();
    const id = session.id;
    session.close();
    sync.publish("session", id);
    const meta = store.list().find((entry) => entry.id === id);
    return json({
      id,
      createdAt: meta?.header.createdAt ?? Date.now(),
      cwd: meta?.header.cwd ?? workspace,
      title: null,
    });
  }

  function handleSession(id: string): Response {
    try {
      const events = store.open(id, "read").all();
      const failedCalls = new Set(events.filter(event => event.type === "tool/result")
        .flatMap(event => {
          const data = event.data as { failed?: unknown; toolCallId?: unknown } | null;
          return data?.failed === true && typeof data.toolCallId === "string" ? [data.toolCallId] : [];
        }));
      return json({
        id,
        title: sessionTitle(events) ?? null,
        summary: sessionSummary(events) ?? null,
        archived: sessionArchived(events),
        messages: toChatMessages(events).map(message => message.role === "tool" ? { ...message, failed: message.toolCallId ? failedCalls.has(message.toolCallId) : false } : message),
        tasks: taskSummaries(events, activeRuns.has(id)),
        todos: sessionTodos(events),
        jobs: sessionJobs(events, activeRuns.has(id)),
      });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Unknown session." }, 404);
    }
  }

  function handleSnapshot(id: string): Response {
    try {
      const events = [...(activeHandles.get(id)?.all() ?? store.open(id, "read").all())];
      const state = runStates.get(id);
      const busy = activeRuns.has(id);
      const lastRunEvent = [...events].reverse().find(event => event.type === "run/error" || event.type === "run/started");
      return json({
        id, instance: sync.instance, revision: sync.revision,
        title: sessionTitle(events) ?? null, summary: sessionSummary(events) ?? null, archived: sessionArchived(events),
        messages: toChatMessages(events), events, busy,
        tasks: taskSummaries(events, busy), todos: sessionTodos(events), jobs: sessionJobs(events, busy),
        approvals: [...(state?.approvals.values() ?? [])], questions: [...(state?.questions.values() ?? [])],
        partial: state?.partial ?? null, loop: state?.loop ?? null,
        error: state?.error ?? runStates.error(id) ?? (busy || lastRunEvent?.type !== "run/error" ? null : (lastRunEvent.data as { message?: string } | undefined)?.message ?? null),
      });
    } catch { return json({ error: "Unknown session." }, 404); }
  }

  /** Most recent tool calls from the session event log, including legacy calls. */
  function handleToolLog(id: string, url: URL): Response {
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 50);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      return json({ error: "Invalid tool log page." }, 400);
    }
    try {
      const entries = toolLogEntries(store.open(id, "read").all()).reverse();
      return json({ entries: entries.slice(offset, offset + limit), total: entries.length });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Unknown session." }, 404);
    }
  }

  /** Cursor-based, read-only projection of recorded session events. */
  function handleTrajectory(id: string, url: URL): Response {
    const optional = (key: string): number | undefined => url.searchParams.has(key) ? Number(url.searchParams.get(key)) : undefined;
    try {
      const options = { limit: optional("limit"), before: optional("before"), after: optional("after") };
      if (["limit", "before", "after"].some(key => url.searchParams.has(key) && !/^\d+$/.test(url.searchParams.get(key) ?? ""))) {
        return json({ error: "Invalid trajectory page." }, 400);
      }
      return json(trajectoryPage(store.open(id, "read").all(), options));
    } catch (error) {
      return json({ error: error instanceof TypeError ? "Invalid trajectory page." : "Could not read session trajectory." }, error instanceof TypeError ? 400 : 404);
    }
  }

  /** Estimated context usage for a session: transcript + tool schemas vs the model window. */
  async function handleContext(id: string): Promise<Response> {
    const config = readConfig();
    if (typeof config === "string") return json({ error: config }, 500);
    const model = await loadModel(config);
    if (typeof model === "string") return json({ error: model }, 400);
    const limit = model.selection.model.maxInputTokens ?? 128_000;
    let used: number;
    try {
      const history = toChatMessages(store.open(id, "read").all());
      const probe = createRingKo({ task: true, model: async () => ({ content: "", toolCalls: [] }) });
      registerTools(probe, config, workspace);
      used = estimateMessagesTokens(history) + estimateToolsTokens(probe.tools.list());
    } catch {
      return json({ error: "Unknown session." }, 404);
    }
    return json({ used, limit, ratio: limit > 0 ? Math.min(1, used / limit) : 0 });
  }

  function handleDeleteSession(id: string): Response {
    if (activeRuns.has(id)) return json({ error: "Cannot delete a running session." }, 409);
    try {
      if (!store.delete(id)) return json({ error: "Unknown session." }, 404);
      runtimeFor(workspace).permissions.clearSession(id);
      sync.publish("session", id);
      return json({ ok: true });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Cannot delete session." }, 500);
    }
  }

  async function handleRenameSession(id: string, request: Request): Promise<Response> {
    const body = await readJson<{ title?: unknown }>(request);
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    if (title.length === 0 || title.length > 512) return json({ error: "title is required (at most 512 characters)." }, 400);
    if (activeRuns.has(id)) return json({ error: "Cannot rename a running session." }, 409);
    let session: SessionHandle;
    try {
      session = store.open(id, "write");
    } catch {
      return json({ error: "Unknown session." }, 404);
    }
    try {
      recordSessionTitle(session, title);
      session.flush();
    } finally {
      session.close();
    }
    sync.publish("session", id);
    return json({ id, title });
  }

  async function handleArchiveSession(id: string, request: Request): Promise<Response> {
    if (activeRuns.has(id)) return json({ error: "Cannot archive a running session." }, 409);
    const body = await readJson<{ archived?: unknown }>(request);
    const archived = body?.archived === undefined ? true : Boolean(body.archived);
    let session: SessionHandle;
    try {
      session = store.open(id, "write");
    } catch {
      return json({ error: "Unknown session." }, 404);
    }
    try {
      recordSessionArchived(session, archived);
      session.flush();
    } finally {
      session.close();
    }
    sync.publish("session", id);
    return json({ id, archived });
  }

  async function handleApproval(request: Request): Promise<Response> {
    const body = await readJson<{ id?: string; approved?: boolean; scope?: "session" | "saved" }>(request);
    if (typeof body?.id !== "string" || !body.id || body.id.length > 128) return json({ error: "valid id required" }, 400);
    if (typeof body.approved !== "boolean" || (body.scope !== undefined && body.scope !== "session" && body.scope !== "saved")) return json({ error: "Invalid approval decision." }, 400);
    const resolveApproval = approvals.get(body.id);
    if (!resolveApproval) return json({ error: "no pending approval" }, 404);
    approvals.delete(body.id);
    resolveApproval(body.approved, body.scope);
    writeDiagnostic("backend.approval", JSON.stringify({ approvalId: body.id, approved: body.approved, scope: body.scope ?? "once" }));
    return json({ ok: true });
  }

  function handlePermissionRules(url: URL): Response {
    const id = url.searchParams.get("sessionId") ?? "";
    if (id.length > 128) return json({ error: "Invalid session id." }, 400);
    try { return json({ workspace, rules: runtimeFor(workspace).permissions.list("", "saved"), sessionRules: runtimeFor(workspace).permissions.list(id, "session") }); }
    catch (error) { return json({ error: error instanceof Error ? error.message : "Cannot load permission rules." }, 500); }
  }

  async function handleRemovePermissionRule(request: Request): Promise<Response> {
    const body = await readJson<{ workspace?: unknown; tool?: unknown; target?: unknown; behavior?: unknown; sessionId?: unknown; scope?: unknown }>(request);
    if (!body || typeof body !== "object" || Array.isArray(body) ||
      typeof body.tool !== "string" || typeof body.behavior !== "string" || typeof body.workspace !== "string") return json({ error: "Invalid permission rule." }, 400);
    if (body.workspace !== workspace) return json({ error: "Workspace changed; refresh permissions." }, 409);
    const scope = body.scope ?? "saved";
    if (scope !== "saved" && scope !== "session") return json({ error: "Invalid permission scope." }, 400);
    const id = typeof body.sessionId === "string" ? body.sessionId : "";
    if (id.length > 128 || (scope === "session" && !id)) return json({ error: "Invalid session id." }, 400);
    try {
      const removed = runtimeFor(workspace).permissions.remove(id, { tool: body.tool, behavior: body.behavior as "allow" | "deny" | "ask", target: body.target as string | undefined }, scope);
      return removed ? json({ ok: true }) : json({ error: "Permission rule not found." }, 404);
    } catch (error) {
      if (error instanceof TypeError) return json({ error: "Invalid permission rule." }, 400);
      return json({ error: error instanceof Error ? error.message : "Cannot update permission rules." }, 500);
    }
  }

  async function handleShell(id: string, request: Request): Promise<Response> {
    const body = await readJson<{ command?: unknown }>(request);
    if (typeof body?.command !== "string" || !body.command.trim() || body.command.length > 16384) return json({ error: "A shell command of at most 16384 characters is required." }, 400);
    if (activeRuns.has(id)) return json({ error: "Session is busy." }, 409);
    if (activeRuns.size >= MAX_ACTIVE_RUNS) return json({ error: "Too many active sessions." }, 429);
    let session: SessionHandle;
    try { session = store.open(id, "write"); } catch { return json({ error: "Unknown or locked session." }, 404); }
    const call = { id: randomUUID(), name: "shell", arguments: { command: body.command } };
    const abort = beginRun(session, () => {
      session.appendEvent("run/started", { kind: "shell" });
      recordUserMessage(session, `!${body.command}`); recordAssistantMessage(session, 0, "", [call]); recordToolCall(session, 0, call);
    });
    const tool = createShellTool({ cwd: workspace });
    void (async () => {
      try {
        const result = await tool.execute(tool.parseInput(call.arguments), { signal: abort.signal });
        recordToolResult(session, 0, call.id, "shell", JSON.stringify(result), "exitCode" in result && result.exitCode !== 0);
      } catch (error) { recordToolResult(session, 0, call.id, "shell", error instanceof Error ? error.message : "Shell failed.", true); }
      finally {
        try { session.close(); }
        catch (error) { runStates.update(id, "error", { message: "Session persistence failed. Inspect diagnostics before continuing." }); writeDiagnostic("session.close", String(error)); }
        activeHandles.delete(id); activeRuns.delete(id); runStates.finish(id); sync.publish("session", id);
      }
    })().catch(error => writeDiagnostic("shell.run", String(error)));
    return json({ sessionId: id }, 202);
  }

  async function handleChat(request: Request, detached = false): Promise<Response> {
    const runWorkspace = workspace;
    const runStore = store;
    const body = await readJson<{ prompt?: string; sessionId?: string; attachments?: unknown; loop?: unknown }>(request);
    if (typeof body?.prompt !== "string" || body.prompt.length > 65536 || (body.sessionId !== undefined && (typeof body.sessionId !== "string" || body.sessionId.length > 128))) return json({ error: "Invalid chat message." }, 400);
    let loopOptions: LoopOptions | undefined;
    if (body.loop !== undefined) {
      const args = body.loop && typeof body.loop === "object" && !Array.isArray(body.loop) && typeof (body.loop as { args?: unknown }).args === "string" ? (body.loop as { args: string }).args : undefined;
      if (args === undefined || args.length > 65536) return json({ error: "Invalid loop request." }, 400);
      const parsed = parseLoopArgs(args);
      if (!parsed.ok) return json({ error: parsed.error }, 400);
      loopOptions = parsed.options;
    }
    const raw = body.prompt.trim();
    const attachments = Array.isArray(body?.attachments)
      ? body.attachments.filter((value): value is string => typeof value === "string" && value.length > 0)
      : [];
    if (attachments.length > 16 || attachments.some(path => path.length > 4096 || path.includes("\0"))) return json({ error: "Invalid attachments." }, 400);
    if (raw.length === 0) return json({ error: "prompt required" }, 400);
    const prompt = attachments.length
      ? `${raw}\n\nAttached files (read them if relevant): ${attachments.join(", ")}`
      : raw;

    const config = readConfig();
    if (typeof config === "string") return json({ error: config }, 500);
    const model = await loadModel(config);
    if (typeof model === "string") return json({ error: model }, 400);
    const small = config.small_model ? await loadModel({ ...config, model: config.small_model }) : undefined;
    if (workspace !== runWorkspace) return json({ error: "Workspace changed; retry in the correct workspace." }, 409);
    if (activeRuns.size >= MAX_ACTIVE_RUNS) return json({ error: "Too many active sessions. Wait for a running session to finish." }, 429);

    let session: SessionHandle;
    let history: ChatMessage[] = [];
    try {
      if (body?.sessionId) {
        if (activeRuns.has(body.sessionId)) return json({ error: "This session already has an active run. Queue the message until it finishes." }, 409);
        const existing = runStore.open(body.sessionId, "read");
        if (existing.header.cwd && resolve(existing.header.cwd) !== runWorkspace) return json({ error: "Session belongs to a different workspace." }, 409);
        history = toChatMessages(existing.all());
        session = runStore.open(body.sessionId, "write");
      } else {
        session = runStore.create();
      }
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Unknown session." }, 404);
    }

    const encoder = new TextEncoder();
    const abort = beginRun(session, () => {
      session.appendEvent("run/started", {});
      recordSessionModel(session, `${model.selection.provider.name}/${model.selection.model.id}`);
      if (config.thinking) recordSessionThinking(session, config.thinking);
    });
    let closed = false;
    const pendingApprovals = new Set<string>();
    let managed: RuntimeAgent | undefined;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: string, data: unknown): void => {
          runStates.update(session.id, event, data);
          sync.publish("activity", session.id);
          if (!closed && !detached) {
            if ((controller.desiredSize ?? 0) < 0) { closed = true; controller.close(); return; }
            try { controller.enqueue(encoder.encode(sse(event, data))); } catch { closed = true; }
          }
        };
        send("session", { sessionId: session.id });
        try {
          const asker = new AskManager(event => {
            session.appendEvent(`ask/${event.type}`, event); session.flush();
            if (event.type === "requested") { questions.set(event.id, asker); send("ask", event); }
            else { questions.delete(event.id); send("ask_closed", { id: event.id }); }
          });
          managed = runtimeFor(runWorkspace).createAgent(config, {
            model: model.client,
            onDelta: delta => send("delta", delta),
            task: true,
            log: eventLog,
            taskModels: configuredModelIds(config),
             resolveTaskModel: async id => { const built = await loadModel({ ...config, model: id }); if (typeof built === "string") throw new Error(built); return built.client; },
            onJobEvent: event => send("job", event),
            onTaskEvent: event => send("task", event),
            session,
            history,
            modelId: model.selection.model.id,
            ...(small && typeof small !== "string" ? { smallModel: small.client } : {}),
            ...(model.selection.model.maxInputTokens ? { contextWindow: model.selection.model.maxInputTokens } : {}),
            ...(model.selection.model.maxOutputTokens ? { reserveOutputTokens: model.selection.model.maxOutputTokens } : {}),
            ...(config.compaction ? { compaction: config.compaction } : {}),
            ...(isAccessMode(config.permission)
              ? { accessMode: config.permission }
              : isAccessMode(config.mode)
                ? { accessMode: config.mode }
                : {}),
            requestApproval: async (approval) => {
              const id = randomUUID();
              send("approval", { id, toolName: approval.toolName, riskLevel: approval.riskLevel, riskKind: approval.riskKind, reason: approval.reason, target: approval.target ?? null });
              return await new Promise<boolean>((resolveApproval) => {
                const approvalSignal = approval.signal ?? abort.signal;
                let settled = false;
                const finish = (approved: boolean, scope?: "session" | "saved") => {
                  if (settled) return;
                  settled = true;
                  if (approved && scope) approval.remember?.(scope);
                  clearTimeout(timer);
                  approvals.delete(id); pendingApprovals.delete(id);
                  send("approval_closed", { id });
                  approvalSignal.removeEventListener("abort", cancel);
                  resolveApproval(approved);
                };
                const cancel = () => finish(false);
                const timer = setTimeout(cancel, APPROVAL_TIMEOUT_MS);
                timer.unref?.();
                approvals.set(id, finish); pendingApprovals.add(id);
                approvalSignal.addEventListener("abort", cancel, { once: true });
                if (approvalSignal.aborted) cancel();
              });
            },
            onEvent: (event) => {
              sync.publish("activity", session.id);
              if (event.type === "model") {
                send("assistant", {
                  turn: event.turn,
                  content: event.message.content,
                  reasoning: event.message.reasoning ?? null,
                  toolCalls: event.message.toolCalls ?? [],
                });
              } else if (event.type === "tool" || event.type === "tool_error") {
                send("tool", {
                  turn: event.turn,
                  name: event.toolName ?? event.message.name ?? "tool",
                  toolCallId: event.message.toolCallId ?? null,
                  content: event.message.content,
                  error: event.type === "tool_error",
                });
              }
            },
          }, { ask: asker.request, onTodo: items => send("todo", { items }), report: message => send("notice", { message }) });
          const ringko = managed.agent;
          activeAgents.set(session.id, ringko);
          // Title and summary are best-effort: a slow or failed generation must
          // never delay or reject the completed run.
          let metaStarted = false;
          const maybeMeta = (): void => {
            if (metaStarted || sessionTitle(session.all())) return;
            metaStarted = true;
            const metaModel = small && typeof small !== "string" ? small.client : model.client;
            const collected: SessionEvent[] = [];
            const target = { appendEvent: (type: string, data?: unknown): SessionEvent => { const event = { type, data, seq: collected.length, time: Date.now() }; collected.push(event); return event; }, flush: () => {} };
            void generateSessionMeta(request => metaModel({ ...request, signal: AbortSignal.timeout(META_TIMEOUT_MS) }), toChatMessages(session.all()), target)
              .then(meta => {
                if (!meta) return;
                const current = activeHandles.get(session.id);
                const writer = current ?? runStore.open(session.id, "write");
                try {
                  if (!sessionTitle(writer.all())) { writer.append(collected); writer.flush(); sync.publish("session", session.id); }
                } finally { if (!current) writer.close(); }
              })
              .catch(error => writeDiagnostic("session.meta", error instanceof Error ? error.message : "Metadata persistence failed."));
          };
          if (loopOptions) {
            const options = loopOptions;
            const text = loopPrompt(options);
            for (let iteration = 1; ; iteration += 1) {
              send("loop", { iteration, maxIterations: options.maxIterations, promise: options.completionPromise ?? null });
              const result = await ringko.run(text, { signal: abort.signal });
              maybeMeta();
              const complete = options.completionPromise !== undefined && promiseText(result.content) === options.completionPromise;
              const exhausted = options.maxIterations > 0 && iteration >= options.maxIterations;
              if (complete || exhausted) {
                send("done", { sessionId: session.id, content: result.content, turns: result.turns });
                break;
              }
              abort.signal.throwIfAborted();
            }
          } else {
            const result = await ringko.run(prompt, { signal: abort.signal });
            maybeMeta();
            send("done", { sessionId: session.id, content: result.content, turns: result.turns });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Run failed.";
          try { session.appendEvent("run/error", { message }); session.flush(); }
          catch (failure) { writeDiagnostic("session.persist", String(failure)); }
          send("error", { message });
        } finally {
          try { managed?.close(); } catch (error) { writeDiagnostic("runtime.agent.close", String(error)); }
          activeRuns.delete(session.id);
          activeAgents.delete(session.id);
          for (const id of pendingApprovals) approvals.get(id)?.(false);
          try { session.close(); }
          catch (error) { send("error", { message: "Session persistence failed. Inspect diagnostics before continuing." }); writeDiagnostic("session.close", String(error)); }
          activeHandles.delete(session.id);
          runStates.finish(session.id);
          writeDiagnostic("backend.run.finish", JSON.stringify({ sessionId: session.id }));
          sync.publish("session", session.id);
          if (!closed) { closed = true; try { controller.close(); } catch { /* Consumer detached during completion. */ } }
        }
      },
      cancel() { closed = true; },
    }, { highWaterMark: 256 * 1024, size: chunk => chunk?.byteLength ?? 0 });

    if (detached) return json({ sessionId: session.id }, 202);

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  }

  async function proxyDev(request: Request, url: URL): Promise<Response> {
    const target = new URL(url.pathname + url.search, options.devServerUrl);
    const headers = new Headers(request.headers);
    headers.delete("host");
    const init: RequestInit = { method: request.method, headers, redirect: "manual" };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.arrayBuffer();
    }
    try {
      return await fetch(target, init);
    } catch {
      return new Response(
        `Dev server unreachable at ${options.devServerUrl}. Start \`pnpm --filter @ringko-ai/webui dev\`.`,
        { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }
  }

  async function serveStatic(pathname: string): Promise<Response> {
    const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const target = resolve(join(webuiDir, rel));
    const withinRoot = relative(webuiDir, target);
    if (withinRoot.startsWith("..") || withinRoot.includes("..")) return json({ error: "not found" }, 404);
    let file = target;
    try {
      if (statSync(file).isDirectory()) file = join(file, "index.html");
    } catch {
      file = join(webuiDir, "index.html");
    }
    try {
      const bytes = await readFile(file);
      return new Response(bytes, { headers: { "content-type": MIME[extname(file)] ?? "application/octet-stream" } });
    } catch {
      return new Response("RingKo WebUI is not built yet. Run `pnpm --filter @ringko-ai/webui build`.", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
  }

  function terminalOriginAllowed(request: Request): boolean {
    const origin = request.headers.get("origin");
    if (!origin) return true;
    try {
      return new URL(origin).origin === new URL(request.url).origin;
    } catch {
      return false;
    }
  }

  function removeTerminal(id: string, terminate: boolean): void {
    const session = terminalSessions.get(id);
    if (!session) return;
    terminalSessions.delete(id);
    if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
    if (terminate && !session.exited) session.terminal.kill();
  }

  function scheduleTerminalCleanup(id: string): void {
    const session = terminalSessions.get(id);
    if (!session) return;
    session.cleanupTimer = setTimeout(() => removeTerminal(id, true), TERMINAL_SESSION_TTL_MS);
    session.cleanupTimer.unref?.();
  }

  function startInteractiveTerminal(
    shell: string,
    args: string[],
    cwd: string,
    cols: number,
    rows: number,
  ): InteractiveTerminal {
    const nodePath = Bun.which("node");
    if (!nodePath) throw new Error("Interactive terminals require Node.js in PATH.");
    const bridgePath = join(import.meta.dir, "terminal-bridge.mjs");
    const child = Bun.spawn([nodePath, bridgePath], {
      cwd,
      env: { ...process.env },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    let dataHandler: (data: string) => void = () => {};
    let errorHandler: (message: string) => void = () => {};
    let exitHandler: (event: { exitCode: number; signal?: number }) => void = () => {};
    let exitReceived = false;

    const sendControl = (message: Record<string, unknown>): void => {
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`);
        child.stdin.flush();
      } catch (cause) {
        errorHandler(cause instanceof Error ? cause.message : String(cause));
      }
    };

    const terminal: InteractiveTerminal = {
      write: (data) => sendControl({ type: "input", data }),
      resize: (nextCols, nextRows) => sendControl({ type: "resize", cols: nextCols, rows: nextRows }),
      kill: () => {
        sendControl({ type: "dispose" });
        const forceKill = setTimeout(() => child.kill(), 1_500);
        forceKill.unref?.();
      },
      onData: (handler) => { dataHandler = handler; },
      onError: (handler) => { errorHandler = handler; },
      onExit: (handler) => { exitHandler = handler; },
    };

    void new Response(child.stderr).text().then((stderr) => {
      if (stderr.trim() && !exitReceived) errorHandler(stderr.trim());
    });

    void (async () => {
      const reader = child.stdout.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          let newline = pending.indexOf("\n");
          while (newline !== -1) {
            const line = pending.slice(0, newline);
            pending = pending.slice(newline + 1);
            if (line) {
              const event = JSON.parse(line) as { type?: unknown; data?: unknown; message?: unknown; exitCode?: unknown; signal?: unknown };
              if (event.type === "output" && typeof event.data === "string") dataHandler(event.data);
              else if (event.type === "error" && typeof event.message === "string") errorHandler(event.message);
              else if (event.type === "exit") {
                exitReceived = true;
                exitHandler({
                  exitCode: typeof event.exitCode === "number" ? event.exitCode : 1,
                  ...(typeof event.signal === "number" ? { signal: event.signal } : {}),
                });
              }
            }
            newline = pending.indexOf("\n");
          }
        }
        pending += decoder.decode();
        if (pending.trim()) throw new Error("Terminal bridge ended with an incomplete event.");
      } catch (cause) {
        errorHandler(cause instanceof Error ? cause.message : String(cause));
      } finally {
        reader.releaseLock();
        const exitCode = await child.exited;
        if (!exitReceived) exitHandler({ exitCode });
      }
    })();

    sendControl({ type: "start", shell, args, cwd, cols, rows });
    return terminal;
  }

  async function handleCreateTerminal(request: Request): Promise<Response> {
    if (!terminalOriginAllowed(request)) return json({ error: "Terminal requests must come from this server's origin." }, 403);
    if (terminalSessions.size >= MAX_TERMINAL_SESSIONS) {
      return json({ error: `At most ${MAX_TERMINAL_SESSIONS} terminal sessions may be active.` }, 429);
    }
    let body: { cols?: unknown; rows?: unknown } | undefined;
    try {
      const parsed: unknown = await request.json();
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json({ error: "Terminal dimensions must be an object." }, 400);
      }
      body = parsed as { cols?: unknown; rows?: unknown };
    } catch {
      return json({ error: "Invalid terminal request." }, 400);
    }
    const cols = body.cols === undefined ? 80 : body.cols;
    const rows = body.rows === undefined ? 24 : body.rows;
    if (
      typeof cols !== "number" || !Number.isInteger(cols) || cols < 20 || cols > 300 ||
      typeof rows !== "number" || !Number.isInteger(rows) || rows < 5 || rows > 120
    ) {
      return json({ error: "Terminal dimensions are outside the supported range." }, 400);
    }

    const shell = process.platform === "win32"
      ? process.env.COMSPEC ?? "powershell.exe"
      : process.env.SHELL ?? "/bin/bash";
    const args = process.platform === "win32"
      ? (shell.toLowerCase().includes("powershell") ? ["-NoLogo", "-NoExit"] : [])
      : ["-i"];
    let terminal: InteractiveTerminal;
    try {
      terminal = startInteractiveTerminal(shell, args, workspace, cols, rows);
    } catch (cause) {
      return json({ error: cause instanceof Error ? cause.message : "Could not start a terminal." }, 500);
    }

    const id = randomUUID();
    const session: TerminalSession = { terminal, exited: false, pendingOutput: "" };
    terminalSessions.set(id, session);
    terminal.onData((data) => {
      if (session.socket?.readyState === 1) {
        session.socket.send(JSON.stringify({ type: "output", data }));
      } else if (session.pendingOutput.length < 1_000_000) {
        session.pendingOutput = `${session.pendingOutput}${data}`.slice(-1_000_000);
      }
    });
    terminal.onError((message) => {
      session.socket?.send(JSON.stringify({ type: "error", message }));
    });
    terminal.onExit(({ exitCode, signal }) => {
      session.exited = true;
      session.socket?.send(JSON.stringify({ type: "exit", exitCode, signal }));
      scheduleTerminalCleanup(id);
    });
    scheduleTerminalCleanup(id);
    return json({ id });
  }

  const server = Bun.serve<TerminalSocketData>({
    hostname: host,
    port,
    idleTimeout: 255,
    websocket: {
      maxPayloadLength: 32 * 1024,
      open(socket) {
        const terminalId = socket.data?.terminalId;
        const session = terminalId ? terminalSessions.get(terminalId) : undefined;
        if (!session) {
          socket.close(1008, "Terminal session no longer exists.");
          return;
        }
        if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
        session.cleanupTimer = undefined;
        session.socket = socket;
        if (session.pendingOutput) {
          socket.send(JSON.stringify({ type: "output", data: session.pendingOutput }));
          session.pendingOutput = "";
        }
      },
      message(socket, message) {
        const terminalId = socket.data?.terminalId;
        const session = terminalId ? terminalSessions.get(terminalId) : undefined;
        if (!terminalId || !session || typeof message !== "string") {
          socket.close(1008, "Invalid terminal message.");
          return;
        }
        let input: { type?: unknown; data?: unknown; cols?: unknown; rows?: unknown };
        try {
          const parsed: unknown = JSON.parse(message);
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError();
          input = parsed as typeof input;
        } catch {
          socket.close(1008, "Malformed terminal message.");
          return;
        }
        if (input.type === "input" && typeof input.data === "string" && input.data.length <= 16_384) {
          if (!session.exited) session.terminal.write(input.data);
          return;
        }
        if (
          input.type === "resize" &&
          typeof input.cols === "number" && Number.isInteger(input.cols) && input.cols >= 20 && input.cols <= 300 &&
          typeof input.rows === "number" && Number.isInteger(input.rows) && input.rows >= 5 && input.rows <= 120
        ) {
          if (!session.exited) session.terminal.resize(input.cols, input.rows);
          return;
        }
        if (input.type === "dispose") {
          removeTerminal(terminalId, true);
          socket.close(1000, "Terminal closed.");
          return;
        }
        socket.close(1008, "Unsupported terminal message.");
      },
      close(socket) {
        const terminalId = socket.data?.terminalId;
        const session = terminalId ? terminalSessions.get(terminalId) : undefined;
        if (terminalId && session?.socket === socket) {
          session.socket = undefined;
          scheduleTerminalCleanup(terminalId);
        }
      },
    },
    async fetch(request) {
      const url = new URL(request.url);
      const handleRequest = async (): Promise<Response | undefined> => {
      // Local UI APIs must not be reachable from an unrelated browser origin (CSRF/DNS rebinding).
      const allowedHosts = new Set([host, "localhost", "127.0.0.1", "[::1]"]);
      if (loopback && url.pathname.startsWith("/api/") && !allowedHosts.has(url.hostname)) return json({ error: "Invalid backend host." }, 403);
      const origin = request.headers.get("origin");
      if (url.pathname.startsWith("/api/") && origin && origin !== url.origin && origin !== options.devServerUrl) return json({ error: "Cross-origin backend request denied." }, 403);
      const expectedWorkspace = request.headers.get("x-ringko-workspace");
      if (expectedWorkspace) {
        try { if (resolve(decodeURIComponent(expectedWorkspace)) !== workspace) return json({ error: "Backend workspace changed. Reconnect to the correct workspace." }, 409); }
        catch { return json({ error: "Invalid workspace header." }, 400); }
      }
      if (url.pathname === "/api/info") return await handleInfo();
      const terminalSocketRequest =
        request.method === "GET" &&
        url.pathname.startsWith("/api/terminal/") &&
        url.pathname.endsWith("/socket");
      if (url.pathname.startsWith("/api/") && options.authToken && !terminalSocketRequest) {
        if (request.headers.get("authorization") !== `Bearer ${options.authToken}`) {
          return json({ error: "unauthorized" }, 401);
        }
      }
      if (url.pathname === "/api/backend" && request.method === "GET") return json({ protocol: PROTOCOL_VERSION, instance: sync.instance, workspace, configPath: options.configPath ? resolve(options.configPath) : null });
      if (url.pathname === "/api/backend/stop" && request.method === "POST") {
        if (activeRuns.size) return json({ error: "Stop active sessions before stopping the backend." }, 409);
        setTimeout(() => { sync.close(); stopTimeSource(); for (const id of terminalSessions.keys()) removeTerminal(id, true); for (const runtime of runtimes.values()) void runtime.close().catch(error => writeDiagnostic("runtime.close", String(error))); server.stop(true); }, 50);
        return json({ ok: true });
      }
      if (url.pathname === "/api/sync" && request.method === "GET") return sync.stream(request.signal);
      if (url.pathname === "/api/runs" && request.method === "POST") return await handleChat(request, true);
      if (url.pathname === "/api/terminal" && request.method === "POST") {
        return await handleCreateTerminal(request);
      }
      if (url.pathname.startsWith("/api/terminal/") && request.method === "DELETE") {
        const id = url.pathname.slice("/api/terminal/".length);
        if (!id || id.includes("/")) return json({ error: "Invalid terminal session." }, 400);
        removeTerminal(id, true);
        return json({ ok: true });
      }
      if (url.pathname.startsWith("/api/terminal/") && url.pathname.endsWith("/socket") && request.method === "GET") {
        if (!terminalOriginAllowed(request)) return json({ error: "Terminal sockets must come from this server's origin." }, 403);
        const id = url.pathname.slice("/api/terminal/".length, -"/socket".length);
        const session = terminalSessions.get(id);
        if (!session || session.socket || session.exited) return json({ error: "Terminal session is unavailable." }, 404);
        if (server.upgrade(request, { data: { terminalId: id } })) return undefined;
        return json({ error: "Could not establish terminal socket." }, 400);
      }
      if (url.pathname.startsWith("/api/workspace/") && request.method === "GET") {
        const review = new WorkspaceReview(workspace);
        const path = url.searchParams.get("path") ?? "";
        try {
          if (url.pathname === "/api/workspace/files") return json(await review.list(path));
          if (url.pathname === "/api/workspace/file") return json(await review.read(path));
          if (url.pathname === "/api/workspace/diff") return json(await review.diff(path, request.signal));
        } catch { return json({ error: "Cannot inspect this workspace path. It must be a regular file/directory inside the workspace; diff requires a Git repository and a bounded patch." }, 400); }
      }
      if (url.pathname === "/api/reload" && request.method === "POST") return await handleInfo();
      if (url.pathname === "/api/auth" && request.method === "GET") return handleAuth();
      if (url.pathname === "/api/auth/default" && request.method === "POST") return await handleSetDefaultAuth(request);
      if (url.pathname === "/api/auth/remove" && request.method === "POST") return await handleRemoveAuthAccount(request);
      if (url.pathname === "/api/auth/oauth" && request.method === "POST") return await handleStartOAuth(request);
      if (url.pathname === "/api/auth/quota" && request.method === "GET") return await handleAuthQuota(request);
      if (url.pathname.startsWith("/api/auth/oauth/") && request.method === "GET") {
        return handleOAuthStatus(decodeURIComponent(url.pathname.slice("/api/auth/oauth/".length)));
      }
      if (url.pathname === "/api/presets" && request.method === "GET") return json({ presets: PROVIDER_PRESETS });
      if (url.pathname === "/api/providers" && request.method === "GET") return handleProviders();
      if (url.pathname === "/api/providers" && request.method === "PUT") return await handleSaveProviders(request);
      if (url.pathname === "/api/projects" && request.method === "GET") return handleProjects();
      if (url.pathname === "/api/projects" && request.method === "POST") return await handleAddProject(request);
      if (url.pathname === "/api/mcp" && request.method === "GET") return handleMcp();
      if (url.pathname === "/api/mcp" && request.method === "PUT") return await handleSaveMcp(request);
      if (url.pathname === "/api/mcp/connected" && request.method === "GET") return await handleMcpConnected();
      if (url.pathname === "/api/mcp/test" && request.method === "POST") return await handleMcpTest(request);
      if (url.pathname === "/api/mcp/oauth" && request.method === "POST") return await handleMcpOAuth(request);
      if (url.pathname === "/api/skills" && request.method === "GET") return handleSkills();
      if (url.pathname === "/api/skills" && request.method === "POST") return await handleCreateSkill(request);
      if (url.pathname === "/api/skills/remove" && request.method === "POST") return await handleRemoveSkill(request);
      if (url.pathname === "/api/fs/list" && request.method === "GET") return handleListDirectory(url);
      if (url.pathname === "/api/fs/mkdir" && request.method === "POST") return await handleCreateDirectory(request);
      if (url.pathname.startsWith("/api/projects/")) {
        const rest = url.pathname.slice("/api/projects/".length);
        const slash = rest.indexOf("/");
        const id = decodeURIComponent(slash === -1 ? rest : rest.slice(0, slash));
        const action = slash === -1 ? "" : rest.slice(slash + 1);
        if (request.method === "DELETE" && action === "") return handleRemoveProject(id);
        if (request.method === "POST" && action === "current") return handleSetCurrentProject(id);
      }
      if (url.pathname === "/api/model" && request.method === "POST") return await handleSetModel(request);
      if (url.pathname === "/api/thinking" && request.method === "POST") return await handleSetThinking(request);
      if (url.pathname === "/api/ui" && request.method === "POST") return await handleSetUi(request);
      if (url.pathname === "/api/compact" && request.method === "POST") return await handleCompact(request);
      if (url.pathname === "/api/access" && request.method === "POST") return await handleSetAccess(request);
      if (url.pathname === "/api/permission" && request.method === "POST") return await handleSetAccess(request);
      if (url.pathname === "/api/permissions" && request.method === "GET") return handlePermissionRules(url);
      if (url.pathname === "/api/permissions" && request.method === "DELETE") return await handleRemovePermissionRule(request);
      if (url.pathname === "/api/mode" && request.method === "POST") return await handleSetMode(request);
      if (url.pathname === "/api/upload" && request.method === "POST") return await handleUpload(request);
      if (url.pathname === "/api/sessions" && request.method === "GET") return handleSessions();
      if (url.pathname === "/api/sessions" && request.method === "POST") return handleCreateSession();
      if (url.pathname.startsWith("/api/sessions/")) {
        const rest = url.pathname.slice("/api/sessions/".length);
        const slash = rest.indexOf("/");
        const id = decodeURIComponent(slash === -1 ? rest : rest.slice(0, slash));
        const action = slash === -1 ? "" : rest.slice(slash + 1);
        if (!id || id.length > 128 || id.includes("\0") || id.includes("/") || id.includes("\\")) return json({ error: "Invalid session id." }, 400);
        if (options.shared) {
          try { const existing = store.open(id, "read"); if (existing.header.cwd && resolve(existing.header.cwd) !== workspace) return json({ error: "Session belongs to a different workspace." }, 409); }
          catch { return json({ error: "Unknown session." }, 404); }
        }
        if (action === "snapshot" && request.method === "GET") return handleSnapshot(id);
        if (action === "shell" && request.method === "POST") return await handleShell(id, request);
        if (action === "jobs" && request.method === "GET") {
          const agent = activeAgents.get(id);
          if (agent) return json(agent.jobs.list());
          try { return json(sessionJobs(store.open(id, "read").all())); } catch { return json({ error: "Unknown session." }, 404); }
        }
        if (action === "jobs" && request.method === "POST") {
          const agent = activeAgents.get(id); if (!agent) return json({ error: "No active jobs." }, 404);
          const body = await readJson<unknown>(request);
          try { return json(await agent.tools.call("job", body)); } catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid job request." }, 400); }
        }
        if (action === "events" && request.method === "GET") {
          const agent = activeAgents.get(id); if (!agent) return json({ error: "No active jobs." }, 404);
          try { return json(await agent.jobs.subscribe({ jobId: url.searchParams.get("jobId") ?? "", after: Number(url.searchParams.get("after") ?? -1), waitMs: Number(url.searchParams.get("waitMs") ?? 0) }, request.signal)); } catch { return json({ error: "Invalid event subscription." }, 400); }
        }
        if (action === "task-detail" && request.method === "GET") {
          try {
            const events = store.open(id, "read").all();
            const taskId = url.searchParams.get("taskId");
            const after = Number(url.searchParams.get("after") ?? -1);
            if (!taskId || taskId.length > 128 || !Number.isSafeInteger(after) || after < -1) return json({ error: "Invalid task cursor." }, 400);
            const task = taskSummaries(events, activeRuns.has(id)).find(item => item.taskId === taskId);
            if (!task) return json({ error: "Unknown task in this session." }, 404);
            const records = events.filter(event => event.seq > after && event.type.startsWith("task/") && event.data && typeof event.data === "object" && (event.data as { taskId?: string }).taskId === taskId).slice(0, 100);
            return json({ task, records, cursor: records.at(-1)?.seq ?? after });
          } catch { return json({ error: "Unknown session." }, 404); }
        }
        if (request.method === "GET" && action === "") return handleSession(id);
        if (request.method === "DELETE" && action === "") return handleDeleteSession(id);
        if (request.method === "GET" && action === "context") return await handleContext(id);
        if (request.method === "GET" && action === "tool-log") return handleToolLog(id, url);
        if (request.method === "GET" && action === "trajectory") return handleTrajectory(id, url);
        if (request.method === "POST" && action === "fork") return await handleForkSession(id, request);
        if (request.method === "GET" && action === "feedback") return handleGetFeedback(id);
        if (request.method === "POST" && action === "feedback") return await handleSetFeedback(id, request);
        if (request.method === "POST" && action === "stop") {
          const run = activeRuns.get(id);
          if (!run) return json({ error: "No active run for this session." }, 404);
          run.abort();
          return json({ ok: true });
        }
        if (request.method === "POST" && action === "title") return await handleRenameSession(id, request);
        if (request.method === "POST" && action === "archive") return await handleArchiveSession(id, request);
      }
      if (url.pathname === "/api/chat" && request.method === "POST") return await handleChat(request);
      if (url.pathname === "/api/approval" && request.method === "POST") return await handleApproval(request);
      if (url.pathname === "/api/ask" && request.method === "POST") {
        const body = await readJson<{ id?: unknown; output?: unknown; cancel?: unknown }>(request);
        if (typeof body?.id !== "string") return json({ error: "Question id required." }, 400);
        if (body.cancel !== true && body.output === undefined) return json({ error: "Answers or explicit cancellation required." }, 400);
        const asker = questions.get(body.id); if (!asker) return json({ error: "No pending question." }, 404);
        try { asker.respond(body.id, body.cancel === true ? undefined : body.output); return json({ ok: true }); }
        catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid answer." }, 400); }
      }
      if (url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
      if (options.devServerUrl) return await proxyDev(request, url);
      return await serveStatic(url.pathname);
      };
      try {
        const response = await handleRequest();
        if (request.method !== "GET" && response?.ok) {
          if (/^\/api\/(model|thinking|ui|mode|access|permission|permissions|providers|reload|auth|mcp|skills)(\/|$)/.test(url.pathname)) sync.publish("config");
          else if (url.pathname.startsWith("/api/sessions/")) sync.publish("session", decodeURIComponent(url.pathname.slice("/api/sessions/".length).split("/")[0]));
        }
        return response;
      } catch (error) {
        if (error instanceof URIError || error instanceof TypeError) return json({ error: "Invalid backend request." }, 400);
        return json({ error: error instanceof Error ? error.message : "Backend request failed." }, 500);
      }
    },
  });

  const boundPort = server.port ?? port;
  return {
    url: `http://${host}:${boundPort}`,
    port: boundPort,
    stop: () => { sync.close(); stopTimeSource(); for (const run of activeRuns.values()) run.abort(); for (const id of terminalSessions.keys()) removeTerminal(id, true); for (const runtime of runtimes.values()) void runtime.close().catch(() => {}); server.stop(true); },
  };
}
