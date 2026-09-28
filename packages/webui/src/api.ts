// Typed client for the RingKo local server (see @ringko-ai/app).

export interface Access {
  id: string;
  label: string;
  summary: string;
}

export interface ProviderInfo {
  name: string;
  type: string | null;
  models: string[];
}

export type AccessMode = 'approval' | 'assist' | 'full'

export interface ProjectEntry {
  id: string;
  name: string;
  path: string;
}

export interface ProjectsResponse {
  projects: ProjectEntry[];
  current: string | null;
  workspace: string;
  project: { id: string; name: string } | null;
}

export interface Info {
  workspace: string;
  project: { id: string; name: string } | null;
  auth: { required: boolean };
  access: Access;
  accessMode: AccessMode;
  context: { used: number; limit: number };
  thinking: string | null;
  expandThinking: boolean;
  expandTools: boolean;
  model: string | null;
  modelId: string | null;
  providers: ProviderInfo[];
  tools: string[];
}

export interface ModelDefinition {
  name: string;
  id: string;
  thinking?: boolean;
  vision?: boolean;
  toolCalling?: boolean;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  url?: string;
}

export interface ProviderDefinition {
  name: string;
  type?: string;
  vendor?: string;
  baseURL?: string;
  url?: string;
  apiKey?: string;
  module?: string;
  models?: ModelDefinition[];
}

export interface ProviderFile {
  model?: string;
  small_model?: string;
  providers?: ProviderDefinition[];
}

export interface SessionMeta {
  id: string;
  createdAt: number;
  cwd: string | null;
  title?: string | null;
  archived?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments?: unknown;
}

export interface ToolLogEntry {
  id: string;
  callId: string;
  name: string;
  arguments: unknown;
  turn: number | null;
  requestedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  status: 'pending' | 'success' | 'error';
  result: string | null;
}

export interface ToolLogPage {
  entries: ToolLogEntry[];
  total: number;
}

export interface ServerMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
  reasoning?: string;
}

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface TodoItem {
  content: string
  status: TodoStatus
}

export interface Approval {
  id: string;
  toolName: string;
  riskLevel: string;
  reason: string;
  target: string | null;
}

export interface UploadedFile {
  name: string;
  path: string;
}

export interface ChatHandlers {
  onAssistant(message: { content: string; reasoning: string | null; toolCalls: ToolCall[]; turn: number }): void;
  onTool(message: { name: string; content: string; error: boolean; turn: number }): void;
  onApproval(approval: Approval): void;
  onTodo?(items: TodoItem[]): void;
  onDone(result: { sessionId: string; content: string; turns: number }): void;
  onError(message: string): void;
  onUnauthorized?(): void;
}

const BASE = "";
const TOKEN_KEY = "ringko.token";

export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "UnauthorizedError";
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Storage unavailable; the token stays in memory only via the caller.
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Ignore.
  }
}

function authHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  return headers;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { headers: authHeaders() });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return (await response.json()) as T;
}

export function fetchInfo(): Promise<Info> {
  // `/api/info` is unauthenticated so the client can learn whether auth is on.
  return getJson<Info>("/api/info");
}

export interface ContextUsage {
  used: number;
  limit: number;
  ratio: number;
}

export function fetchContext(id: string): Promise<ContextUsage> {
  return getJson<ContextUsage>(`/api/sessions/${encodeURIComponent(id)}/context`);
}

export function fetchSessions(): Promise<SessionMeta[]> {
  return getJson<SessionMeta[]>("/api/sessions");
}

export function fetchSession(id: string): Promise<{ id: string; messages: ServerMessage[] }> {
  return getJson<{ id: string; messages: ServerMessage[] }>(`/api/sessions/${encodeURIComponent(id)}`);
}

export function fetchToolLog(id: string, offset = 0): Promise<ToolLogPage> {
  return getJson<ToolLogPage>(`/api/sessions/${encodeURIComponent(id)}/tool-log?offset=${offset}`);
}

export async function createSession(): Promise<SessionMeta> {
  const response = await fetch(`${BASE}/api/sessions`, { method: "POST", headers: authHeaders() });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error(`Create session failed (${response.status}).`);
  return (await response.json()) as SessionMeta;
}

async function sessionAction(id: string, action: string, body?: unknown): Promise<void> {
  const response = await fetch(`${BASE}/api/sessions/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body ?? {}),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error(`${action} failed (${response.status}).`);
}

export function renameSession(id: string, title: string): Promise<void> {
  return sessionAction(id, "title", { title });
}

export function archiveSession(id: string, archived: boolean): Promise<void> {
  return sessionAction(id, "archive", { archived });
}

export async function deleteSession(id: string): Promise<void> {
  const response = await fetch(`${BASE}/api/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error(`Delete failed (${response.status}).`);
}

export async function respondApproval(id: string, approved: boolean): Promise<void> {
  await fetch(`${BASE}/api/approval`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ id, approved }),
  });
}

export function fetchProjects(): Promise<ProjectsResponse> {
  return getJson<ProjectsResponse>("/api/projects");
}

async function projectRequest(init: RequestInit): Promise<ProjectsResponse> {
  const response = await fetch(`${BASE}/api/projects`, init);
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Request failed (${response.status}).`);
  }
  return (await response.json()) as ProjectsResponse;
}

export interface McpServerEntry {
  name: string;
  source: string;
  kind: string;
  config: Record<string, unknown>;
}

export interface McpPayload {
  servers: McpServerEntry[];
  map: Record<string, Record<string, unknown>>;
}

export function fetchMcp(): Promise<McpPayload> {
  return getJson<McpPayload>("/api/mcp");
}

export async function saveMcp(servers: Record<string, unknown>): Promise<McpPayload> {
  const response = await fetch(`${BASE}/api/mcp`, {
    method: "PUT",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ servers }),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Save failed (${response.status}).`);
  }
  return (await response.json()) as McpPayload;
}

export interface SkillEntry {
  name: string;
  description?: string;
  source: string;
  dir: string;
}

export function fetchSkills(): Promise<SkillEntry[]> {
  return getJson<SkillEntry[]>("/api/skills");
}

export async function createSkill(input: { name: string; description?: string; body?: string }): Promise<SkillEntry[]> {
  const response = await fetch(`${BASE}/api/skills`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(input),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Create failed (${response.status}).`);
  }
  return (await response.json()) as SkillEntry[];
}

export async function removeSkill(dir: string): Promise<SkillEntry[]> {
  const response = await fetch(`${BASE}/api/skills/remove`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ dir }),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error(`Remove failed (${response.status}).`);
  return (await response.json()) as SkillEntry[];
}

export interface DirectoryEntry {
  name: string;
  path: string;
  hidden: boolean;
}

export interface DirectoryListing {
  path: string;
  home: string;
  separator: string;
  crumbs: { name: string; path: string }[];
  entries: DirectoryEntry[];
  truncated: boolean;
}

/** List the child directories of a level (default: the user home directory). */
export function listDirectory(path?: string): Promise<DirectoryListing> {
  const query = path && path.trim().length > 0 ? `?path=${encodeURIComponent(path)}` : "";
  return getJson<DirectoryListing>(`/api/fs/list${query}`);
}

export async function createDirectory(path: string, name: string): Promise<string> {
  const response = await fetch(`${BASE}/api/fs/mkdir`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ path, name }),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Create failed (${response.status}).`);
  }
  return ((await response.json()) as { path: string }).path;
}

export function addProject(path: string, name?: string): Promise<ProjectsResponse> {
  return projectRequest({
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ path, ...(name ? { name } : {}) }),
  });
}

export async function removeProject(id: string): Promise<ProjectsResponse> {
  const response = await fetch(`${BASE}/api/projects/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error(`Remove failed (${response.status}).`);
  return (await response.json()) as ProjectsResponse;
}

export async function setCurrentProject(id: string): Promise<ProjectsResponse> {
  const response = await fetch(`${BASE}/api/projects/${encodeURIComponent(id)}/current`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error(`Switch failed (${response.status}).`);
  return (await response.json()) as ProjectsResponse;
}

export function fetchProviders(): Promise<ProviderFile> {
  return getJson<ProviderFile>("/api/providers");
}

export async function saveProviders(file: ProviderFile): Promise<Info> {
  const response = await fetch(`${BASE}/api/providers`, {
    method: "PUT",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(file),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Save failed (${response.status}).`);
  }
  return (await response.json()) as Info;
}

export async function setAccess(mode: AccessMode): Promise<Info> {
  const response = await fetch(`${BASE}/api/access`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ mode }),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Switch failed (${response.status}).`);
  }
  return (await response.json()) as Info;
}

export async function uploadFile(file: File): Promise<UploadedFile> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${BASE}/api/upload`, { method: "POST", headers: authHeaders(), body: form });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error(`Upload failed (${response.status}).`);
  const data = (await response.json()) as { files: UploadedFile[] };
  return data.files[0];
}

export async function setThinking(level: string): Promise<Info> {
  const response = await fetch(`${BASE}/api/thinking`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ level }),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error(`Set thinking failed (${response.status}).`);
  return (await response.json()) as Info;
}

export async function setUi(patch: { expandThinking?: boolean; expandTools?: boolean }): Promise<Info> {
  const response = await fetch(`${BASE}/api/ui`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(patch),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error(`Set UI failed (${response.status}).`);
  return (await response.json()) as Info;
}

export async function compact(sessionId: string, instructions?: string): Promise<{ compacted: boolean; summary: string | null; tokens: number }> {
  const response = await fetch(`${BASE}/api/compact`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ sessionId, ...(instructions ? { instructions } : {}) }),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Compaction failed (${response.status}).`);
  }
  return (await response.json()) as { compacted: boolean; summary: string | null; tokens: number };
}

export async function setModel(model: string): Promise<Info> {
  const response = await fetch(`${BASE}/api/model`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ model }),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Switch failed (${response.status}).`);
  }
  return (await response.json()) as Info;
}

/** Re-read config from disk and return fresh server info. */
export async function reload(): Promise<Info> {
  const response = await fetch(`${BASE}/api/reload`, { method: "POST", headers: authHeaders() });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error(`Reload failed (${response.status}).`);
  return (await response.json()) as Info;
}

/** Verify a token by calling an authenticated endpoint. */
export async function verifyToken(token: string): Promise<boolean> {
  const response = await fetch(`${BASE}/api/sessions`, { headers: { authorization: `Bearer ${token}` } });
  return response.ok;
}

/** Start a chat run and consume the SSE stream. Returns an abort handle. */
export function streamChat(
  input: { prompt: string; sessionId?: string; attachments?: string[] },
  handlers: ChatHandlers,
): { abort(): void } {
  const controller = new AbortController();

  void (async () => {
    let response: Response;
    try {
      response = await fetch(`${BASE}/api/chat`, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify(input),
        signal: controller.signal,
      });
    } catch (error) {
      if (!controller.signal.aborted) handlers.onError(error instanceof Error ? error.message : "Request failed.");
      return;
    }
    if (response.status === 401) {
      handlers.onUnauthorized?.();
      return;
    }
    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => "");
      handlers.onError(detail || `Request failed (${response.status}).`);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index = buffer.indexOf("\n\n");
        while (index !== -1) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          dispatch(frame);
          index = buffer.indexOf("\n\n");
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) handlers.onError(error instanceof Error ? error.message : "Stream failed.");
    }
  })();

  function dispatch(frame: string): void {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) return;
    let payload: unknown;
    try {
      payload = JSON.parse(dataLines.join("\n"));
    } catch {
      return;
    }
    switch (event) {
      case "assistant":
        handlers.onAssistant(payload as Parameters<ChatHandlers["onAssistant"]>[0]);
        break;
      case "tool":
        handlers.onTool(payload as Parameters<ChatHandlers["onTool"]>[0]);
        break;
      case "approval":
        handlers.onApproval(payload as Approval);
        break;
      case "todo":
        handlers.onTodo?.(((payload as { items?: TodoItem[] }).items ?? []) as TodoItem[]);
        break;
      case "done":
        handlers.onDone(payload as Parameters<ChatHandlers["onDone"]>[0]);
        break;
      case "error":
        handlers.onError((payload as { message?: string }).message ?? "Run failed.");
        break;
      default:
        break;
    }
  }

  return { abort: () => controller.abort() };
}
