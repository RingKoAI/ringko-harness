// Local HTTP + SSE server backing the WebUI. It exposes the harness over a
// small REST surface: info, sessions, a streaming chat endpoint, and a tool
// approval endpoint. Static assets from @ringko-ai/webui are served as well.
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import {
  createRingKo,
  access,
  estimateMessagesTokens,
  estimateToolsTokens,
  isAccessMode,
  type ChatMessage,
  type RingKo,
} from "@ringko-ai/sdk";
import {
  createTodoStore,
  createTodoTool,
  registerNetworkTools,
  registerShellTools,
  registerWorkspaceTools,
} from "@ringko-ai/tools";
import {
  createSkill,
  discoverSkills,
  loadConfig,
  loadMcpServerMap,
  loadMcpServers,
  loadProjects,
  loadProviders,
  modelLabel,
  removeSkill,
  saveMcpServers,
  saveProviders,
  saveProjects,
  saveSettings,
  type McpServerConfig,
  type ModelDefinition,
  type ProviderDefinition,
  type RingkoConfig,
} from "@ringko-ai/config";
import {
  SessionStore,
  recordSessionArchived,
  recordSessionTitle,
  sessionArchived,
  sessionTitle,
  toolLogEntries,
  toChatMessages,
  type SessionHandle,
} from "@ringko-ai/session";
import { loadModel } from "./model.ts";

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
  onTodo?: (items: unknown) => void,
): void {
  registerWorkspaceTools(ringko.tools, { workspace });
  ringko.tools.register(createTodoTool(createTodoStore(onTodo ? (items) => onTodo(items) : undefined)));
  if (config.capabilities?.network) registerNetworkTools(ringko.tools);
  if (config.capabilities?.shell) registerShellTools(ringko.tools, { cwd: workspace });
}

async function readJson<T>(request: Request): Promise<T | undefined> {
  try {
    return (await request.json()) as T;
  } catch {
    return undefined;
  }
}

/** Start the local server. Throws if the port is unavailable. */
export function startServer(options: ServerOptions = {}): RingkoServer {
  const host = options.host ?? process.env.RINGKO_HOST ?? DEFAULT_HOST;
  const configuredPort = Number(process.env.RINGKO_PORT);
  const port = options.port ?? (Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : DEFAULT_PORT);
  let workspace = resolve(options.workspace ?? process.cwd());
  const webuiDir = resolve(options.webuiDir ?? DEFAULT_WEBUI_DIR);
  let store = new SessionStore({ cwd: workspace });
  const approvals = new Map<string, (approved: boolean) => void>();
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
  if (activeProject) {
    try {
      if (statSync(activeProject.path).isDirectory()) workspace = resolve(activeProject.path);
    } catch {
      // Registered project is gone; keep the launch directory.
    }
  }
  store = new SessionStore({ cwd: workspace });

  function activateProject(id: string | undefined): void {
    projects = id ? { projects: projects.projects, current: id } : { projects: projects.projects };
    saveProjects(projects);
    const active = id ? projects.projects.find((entry) => entry.id === id) : undefined;
    workspace = active ? resolve(active.path) : baseWorkspace;
    store = new SessionStore({ cwd: workspace });
  }

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
    const model = loadModel(config);
    const tools = createRingKo({ model: async () => ({ content: "", toolCalls: [] }) });
    registerTools(tools, config, workspace);
    const accessMode = isAccessMode(config.mode) ? config.mode : "approval";
    const activeId = projects.current;
    const active = activeId ? projects.projects.find((entry) => entry.id === activeId) : undefined;
    return json({
      workspace,
      project: active ? { id: active.id, name: active.name } : null,
      auth: { required: Boolean(options.authToken) },
      access: access(accessMode),
      accessMode,
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
      servers: loadMcpServers().map((server) => ({
        name: server.name,
        source: server.source,
        kind: server.config.url ? "http" : "stdio",
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
    const body = await readJson<{ servers?: unknown }>(request);
    if (typeof body?.servers !== "object" || body.servers === null || Array.isArray(body.servers)) {
      return json({ error: "servers must be an object." }, 400);
    }
    const servers: Record<string, McpServerConfig> = {};
    for (const [name, config] of Object.entries(body.servers as Record<string, unknown>)) {
      if (name.trim().length === 0 || typeof config !== "object" || config === null || Array.isArray(config)) {
        return json({ error: `invalid MCP server "${name}".` }, 400);
      }
      servers[name] = config as McpServerConfig;
    }
    try {
      saveMcpServers(servers);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Cannot save MCP configuration." }, 500);
    }
    return handleMcp();
  }

  function handleSkills(): Response {
    return json(discoverSkills().map((skill) => ({ ...skill })));
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
      if (!removeSkill(dir)) return json({ error: "Unknown skill directory." }, 404);
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

  /** A session's title, or its first user message truncated as a fallback. */
  function sessionLabel(id: string): string | null {
    try {
      const events = store.open(id, "read").all();
      const title = sessionTitle(events);
      if (title && title.trim().length > 0) return title;
      const firstUser = toChatMessages(events).find((message) => message.role === "user");
      const text = firstUser?.content.trim();
      return text && text.length > 0 ? text.slice(0, 60) : null;
    } catch {
      return null;
    }
  }

  async function handleSetAccess(request: Request): Promise<Response> {
    const body = await readJson<{ mode?: unknown }>(request);
    const mode = body?.mode;
    if (!isAccessMode(mode)) {
      return json({ error: 'mode must be "approval" | "assist" | "full".' }, 400);
    }
    const config = readConfig();
    if (typeof config === "string") return json({ error: config }, 500);
    saveSettings({ ...config, mode });
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
    saveSettings({ ...config, thinking: level });
    return await handleInfo();
  }

  async function handleSetUi(request: Request): Promise<Response> {
    const body = await readJson<{ expandThinking?: unknown; expandTools?: unknown }>(request);
    const config = readConfig();
    if (typeof config === "string") return json({ error: config }, 500);
    const next: RingkoConfig = { ...config };
    if (typeof body?.expandThinking === "boolean") next.expandThinking = body.expandThinking;
    if (typeof body?.expandTools === "boolean") next.expandTools = body.expandTools;
    saveSettings(next);
    return await handleInfo();
  }

  async function handleCompact(request: Request): Promise<Response> {
    const body = await readJson<{ sessionId?: unknown; instructions?: unknown }>(request);
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
    if (sessionId.length === 0) return json({ error: "sessionId is required." }, 400);
    const config = readConfig();
    if (typeof config === "string") return json({ error: config }, 500);
    const model = loadModel(config);
    if (typeof model === "string") return json({ error: model }, 400);
    const small = config.small_model ? loadModel({ ...config, model: config.small_model }) : undefined;
    let session: SessionHandle;
    let history: ChatMessage[] = [];
    try {
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
    saveProviders({ ...loadProviders(), model: target });
    return await handleInfo();
  }

  function handleSessions(): Response {
    return json(
      store.list().map((meta) => ({
        id: meta.id,
        createdAt: meta.header.createdAt,
        cwd: meta.header.cwd ?? null,
        title: sessionLabel(meta.id),
        archived: sessionArchived(store.open(meta.id, "read").all()),
      })),
    );
  }

  function handleCreateSession(): Response {
    const session = store.create();
    const id = session.id;
    session.close();
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
      return json({
        id,
        title: sessionTitle(events) ?? null,
        archived: sessionArchived(events),
        messages: toChatMessages(events),
      });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Unknown session." }, 404);
    }
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

  /** Estimated context usage for a session: transcript + tool schemas vs the model window. */
  function handleContext(id: string): Response {
    const config = readConfig();
    if (typeof config === "string") return json({ error: config }, 500);
    const model = loadModel(config);
    if (typeof model === "string") return json({ error: model }, 400);
    const limit = model.selection.model.maxInputTokens ?? 128_000;
    let used: number;
    try {
      const history = toChatMessages(store.open(id, "read").all());
      const probe = createRingKo({ model: async () => ({ content: "", toolCalls: [] }) });
      registerTools(probe, config, workspace);
      used = estimateMessagesTokens(history) + estimateToolsTokens(probe.tools.list());
    } catch {
      return json({ error: "Unknown session." }, 404);
    }
    return json({ used, limit, ratio: limit > 0 ? Math.min(1, used / limit) : 0 });
  }

  function handleDeleteSession(id: string): Response {
    try {
      return store.delete(id) ? json({ ok: true }) : json({ error: "Unknown session." }, 404);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Cannot delete session." }, 500);
    }
  }

  async function handleRenameSession(id: string, request: Request): Promise<Response> {
    const body = await readJson<{ title?: unknown }>(request);
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    if (title.length === 0) return json({ error: "title is required." }, 400);
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
    return json({ id, title });
  }

  async function handleArchiveSession(id: string, request: Request): Promise<Response> {
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
    return json({ id, archived });
  }

  async function handleApproval(request: Request): Promise<Response> {
    const body = await readJson<{ id?: string; approved?: boolean }>(request);
    if (!body?.id) return json({ error: "id required" }, 400);
    const resolveApproval = approvals.get(body.id);
    if (!resolveApproval) return json({ error: "no pending approval" }, 404);
    approvals.delete(body.id);
    resolveApproval(Boolean(body.approved));
    return json({ ok: true });
  }

  async function handleChat(request: Request): Promise<Response> {
    const body = await readJson<{ prompt?: string; sessionId?: string; attachments?: unknown }>(request);
    const raw = (body?.prompt ?? "").trim();
    const attachments = Array.isArray(body?.attachments)
      ? body.attachments.filter((value): value is string => typeof value === "string" && value.length > 0)
      : [];
    if (raw.length === 0) return json({ error: "prompt required" }, 400);
    const prompt = attachments.length
      ? `${raw}\n\nAttached files (read them if relevant): ${attachments.join(", ")}`
      : raw;

    const config = readConfig();
    if (typeof config === "string") return json({ error: config }, 500);
    const model = loadModel(config);
    if (typeof model === "string") return json({ error: model }, 400);
    const small = config.small_model ? loadModel({ ...config, model: config.small_model }) : undefined;

    let session: SessionHandle;
    let history: ChatMessage[] = [];
    try {
      if (body?.sessionId) {
        history = toChatMessages(store.open(body.sessionId, "read").all());
        session = store.open(body.sessionId, "write");
      } else {
        session = store.create();
      }
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Unknown session." }, 404);
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        const send = (event: string, data: unknown): void => {
          if (!closed) controller.enqueue(encoder.encode(sse(event, data)));
        };
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
            ...(isAccessMode(config.mode) ? { accessMode: config.mode } : {}),
            requestApproval: async (approval) => {
              const id = randomUUID();
              send("approval", { id, toolName: approval.toolName, riskLevel: approval.riskLevel, reason: approval.reason, target: approval.target ?? null });
              return await new Promise<boolean>((resolveApproval) => {
                approvals.set(id, resolveApproval);
                setTimeout(() => {
                  if (approvals.delete(id)) resolveApproval(false);
                }, APPROVAL_TIMEOUT_MS).unref?.();
              });
            },
            onEvent: (event) => {
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
                  content: event.message.content,
                  error: event.type === "tool_error",
                });
              }
            },
          });
          registerTools(ringko, config, workspace, (items) => send("todo", { items }));
          const result = await ringko.run(prompt);
          send("done", { sessionId: session.id, content: result.content, turns: result.turns });
        } catch (error) {
          send("error", { message: error instanceof Error ? error.message : "Run failed." });
        } finally {
          closed = true;
          session.close();
          controller.close();
        }
      },
    });

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

  const server = Bun.serve({
    hostname: host,
    port,
    idleTimeout: 255,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/api/info") return await handleInfo();
      if (url.pathname.startsWith("/api/") && options.authToken) {
        if (request.headers.get("authorization") !== `Bearer ${options.authToken}`) {
          return json({ error: "unauthorized" }, 401);
        }
      }
      if (url.pathname === "/api/reload" && request.method === "POST") return await handleInfo();
      if (url.pathname === "/api/providers" && request.method === "GET") return handleProviders();
      if (url.pathname === "/api/providers" && request.method === "PUT") return await handleSaveProviders(request);
      if (url.pathname === "/api/projects" && request.method === "GET") return handleProjects();
      if (url.pathname === "/api/projects" && request.method === "POST") return await handleAddProject(request);
      if (url.pathname === "/api/mcp" && request.method === "GET") return handleMcp();
      if (url.pathname === "/api/mcp" && request.method === "PUT") return await handleSaveMcp(request);
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
      if (url.pathname === "/api/upload" && request.method === "POST") return await handleUpload(request);
      if (url.pathname === "/api/sessions" && request.method === "GET") return handleSessions();
      if (url.pathname === "/api/sessions" && request.method === "POST") return handleCreateSession();
      if (url.pathname.startsWith("/api/sessions/")) {
        const rest = url.pathname.slice("/api/sessions/".length);
        const slash = rest.indexOf("/");
        const id = decodeURIComponent(slash === -1 ? rest : rest.slice(0, slash));
        const action = slash === -1 ? "" : rest.slice(slash + 1);
        if (request.method === "GET" && action === "") return handleSession(id);
        if (request.method === "DELETE" && action === "") return handleDeleteSession(id);
        if (request.method === "GET" && action === "context") return handleContext(id);
        if (request.method === "GET" && action === "tool-log") return handleToolLog(id, url);
        if (request.method === "POST" && action === "title") return await handleRenameSession(id, request);
        if (request.method === "POST" && action === "archive") return await handleArchiveSession(id, request);
      }
      if (url.pathname === "/api/chat" && request.method === "POST") return await handleChat(request);
      if (url.pathname === "/api/approval" && request.method === "POST") return await handleApproval(request);
      if (url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
      if (options.devServerUrl) return await proxyDev(request, url);
      return await serveStatic(url.pathname);
    },
  });

  const boundPort = server.port ?? port;
  return {
    url: `http://${host}:${boundPort}`,
    port: boundPort,
    stop: () => server.stop(true),
  };
}
