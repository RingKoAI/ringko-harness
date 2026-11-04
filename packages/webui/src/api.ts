// Typed client for the RingKo local server (see @ringko-ai/app).
import { consumeSse, type TodoItem, type SessionUsage } from '@ringko-ai/client';
import { BASE, UnauthorizedError, authHeaders, backendClient, errorFrom, getJson } from './api/http';
export { UnauthorizedError, backendClient, clearToken, getToken, setToken } from './api/http';
export type { SessionSnapshot, TodoItem, SessionUsage } from '@ringko-ai/client';
import type { UsageStatistics, UsageStatisticsQuery } from '@ringko-ai/client';
export type { UsageStatistics, UsageStatisticsQuery, UsageStatisticsBucket, UsageRequest, UsageCallKind } from '@ringko-ai/client';
export * from './api/connectors';
export * from './api/sessions';

export function fetchUsageStatistics(query: UsageStatisticsQuery, signal?: AbortSignal): Promise<UsageStatistics> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
  return backendClient.request(`/api/usage?${params}`, undefined, 'GET', signal);
}

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
  permission: AccessMode;
  mode: { id: string; label: string; description: string | null };
  workflows: { id: string; label: string; description: string | null }[];
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
  contextWindow?: number;
  catalogId?: string;
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
  summary?: string | null;
  archived?: boolean;
  busy?: boolean;
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

export type TrajectoryKind = 'user' | 'assistant' | 'model' | 'tool' | 'task' | 'compaction' | 'session'
export interface TrajectoryRecord {
  seq: number; time: number; type: string; kind: TrajectoryKind; turn: number | null;
  taskId?: string; agent?: 'main' | 'subagent';
  label: string; preview: string; details: string; truncated: boolean; failed: boolean; durationMs: number | null;
}
export interface TrajectoryPage {
  records: TrajectoryRecord[]; hasOlder: boolean; hasNewer: boolean; lastSeq: number;
}

export interface ServerMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
  failed?: boolean;
  toolCalls?: ToolCall[];
  reasoning?: string;
}

export type TodoStatus = TodoItem['status']

export interface Approval {
  id: string;
  toolName: string;
  riskLevel: string;
  riskKind?: string;
  reason: string;
  target: string | null;
}

export interface PermissionRule {
  tool: string;
  target?: string;
  behavior: 'allow' | 'deny' | 'ask';
}

export interface UploadedFile {
  name: string;
  path: string;
}

export interface WorkspaceEntry { name: string; path: string; directory: boolean }
export function fetchWorkspaceFiles(path = ''): Promise<{ path: string; entries: WorkspaceEntry[]; truncated: boolean }> { return getJson(`/api/workspace/files?path=${encodeURIComponent(path)}`) }
export function fetchWorkspaceFile(path: string): Promise<{ path: string; content: string; binary: boolean; truncated: boolean }> { return getJson(`/api/workspace/file?path=${encodeURIComponent(path)}`) }
export function fetchWorkspaceDiff(path = ''): Promise<{ path: string; content: string }> { return getJson(`/api/workspace/diff?path=${encodeURIComponent(path)}`) }

export async function createTerminal(cols: number, rows: number): Promise<{ id: string }> {
  const response = await fetch(`${BASE}/api/terminal`, {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ cols, rows }),
  })
  if (response.status === 401) throw new UnauthorizedError()
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: unknown }
    throw new Error(typeof body.error === 'string' ? body.error : `Terminal start failed (${response.status}).`)
  }
  return await response.json() as { id: string }
}

export async function disposeTerminal(id: string): Promise<void> {
  const response = await fetch(`${BASE}/api/terminal/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (response.status === 401) throw new UnauthorizedError()
  if (!response.ok && response.status !== 404) throw new Error(`Terminal close failed (${response.status}).`)
}

export function terminalSocketUrl(id: string): string {
  const socketUrl = new URL(`/api/terminal/${encodeURIComponent(id)}/socket`, window.location.href)
  socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  return socketUrl.toString()
}

export interface LoopStatus {
  iteration: number;
  maxIterations: number;
  promise: string | null;
}

export interface ChatHandlers {
  onDelta?(delta: { kind: 'text' | 'reasoning'; text: string }): void;
  onJob?(event: JobUpdate): void;
  onAsk?(event: QuestionRequest): void;
  onAskClosed?(id: string): void;
  onTask?(event: TaskUpdate): void;
  onApprovalClosed?(id: string): void;
  onSession?(sessionId: string): void;
  onAssistant(message: { content: string; reasoning: string | null; toolCalls: ToolCall[]; turn: number }): void;
  onTool(message: { name: string; content: string; toolCallId?: string | null; error: boolean; turn: number }): void;
  onApproval(approval: Approval): void;
  onTodo?(items: TodoItem[]): void;
  onUsage?(usage: SessionUsage | null): void;
  onLoop?(status: LoopStatus): void;
  onDone(result: { sessionId: string; content: string; turns: number }): void;
  /** A background title/summary update was persisted for this session. */
  onSessionMeta?(): void;
  onError(message: string): void;
  onUnauthorized?(): void;
}

export interface TaskSummary {
  taskId: string; parentCallId: string | null; description: string; mode: 'read' | 'write' | 'full'; model?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown'; startedAt: number; completedAt: number | null;
  content?: string; reason?: string; activity?: string;
}
export interface TaskUpdate {
  taskId: string; parentCallId: string | null; description: string; mode: 'read' | 'write' | 'full'; model?: string;
  type: 'started' | 'event' | 'completed' | 'failed' | 'cancelled'; time: number;
  reason?: string; result?: { content: string };
  event?: { type: string; toolName?: string; turn: number };
}

export interface TaskRecord { seq: number; time: number; type: string; data: { event?: { type: string; turn: number; toolName?: string; message?: ServerMessage }; reason?: string; result?: { content: string } } }
export function fetchTaskDetail(sessionId: string, taskId: string, after = -1): Promise<{ task: TaskSummary; records: TaskRecord[]; cursor: number }> {
  return getJson(`/api/sessions/${encodeURIComponent(sessionId)}/task-detail?taskId=${encodeURIComponent(taskId)}&after=${after}`)
}

/** Cancel one running subtask of the active run, without needing a cached job snapshot. */
export async function cancelTask(sessionId: string, taskId: string): Promise<void> {
  const response = await fetch(`${BASE}/api/sessions/${encodeURIComponent(sessionId)}/task-cancel`, {
    method: 'POST', headers: authHeaders({ 'content-type': 'application/json' }), body: JSON.stringify({ taskId }),
  })
  if (response.status === 401) throw new UnauthorizedError()
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: unknown } | null
    throw new Error(typeof detail?.error === 'string' ? detail.error : `Task cancellation failed (${response.status}).`)
  }
}

export async function stopSession(id: string): Promise<void> {
  const response = await fetch(`${BASE}/api/sessions/${encodeURIComponent(id)}/stop`, { method: 'POST', headers: authHeaders() });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok && response.status !== 404) throw new Error(`Stop failed (${response.status}).`);
}

export interface QuestionRequest { id: string; input: { questions: Array<{ id: string; question: string; header?: string; detail?: string; multiSelect?: boolean; options?: Array<{ label: string; description?: string }> }> } }
export interface QuestionOutput { answers: Array<{ id: string; selected: string[]; custom?: string }> }
export interface JobSummary { jobId: string; kind: 'sub' | 'shell'; description: string; status: 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown'; background: boolean; lastSeq: number; result?: unknown; output?: string }
export interface JobUpdate { jobId: string; kind: 'sub' | 'shell'; seq: number; type: string; truncated: boolean; data: unknown }
export async function answerQuestion(id: string, output?: QuestionOutput): Promise<void> {
  const response = await fetch(`${BASE}/api/ask`, { method: 'POST', headers: authHeaders({ 'content-type': 'application/json' }), body: JSON.stringify({ id, ...(output ? { output } : { cancel: true }) }) });
  if (!response.ok) throw new Error(`Answer failed (${response.status}).`);
}
export async function jobAction(sessionId: string, jobId: string, action: 'status' | 'cancel' | 'background'): Promise<JobSummary> {
  const response = await fetch(`${BASE}/api/sessions/${encodeURIComponent(sessionId)}/jobs`, { method: 'POST', headers: authHeaders({ 'content-type': 'application/json' }), body: JSON.stringify({ jobId, action }) });
  if (!response.ok) throw new Error(`Job action failed (${response.status}).`);
  return await response.json() as JobSummary;
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

export interface ProviderPreset {
  id: string;
  label: string;
  type: string;
  baseURL?: string;
  apiKeyEnv?: string;
  auth?: string;
  docs?: string;
}

export function fetchPresets(): Promise<{ presets: ProviderPreset[] }> {
  return getJson<{ presets: ProviderPreset[] }>("/api/presets");
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

export interface DiscoveredProviderModel { id: string; name?: string }

/** Query a provider endpoint for its model list using the host-side provider module. */
export async function discoverProviderModels(input: { name: string; type: string; baseURL?: string; apiKey?: string }): Promise<{ models: DiscoveredProviderModel[]; truncated?: boolean }> {
  const response = await fetch(`${BASE}/api/providers/models`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(input),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(typeof detail?.error === "string" ? detail.error : `Model discovery failed (${response.status}).`);
  }
  return (await response.json()) as { models: DiscoveredProviderModel[]; truncated?: boolean };
}

export interface AuthAccount {
  id: string;
  uuid: string;
  login: string;
  avatarUrl: string | null;
  authenticatedAt: number;
  isDefault: boolean;
  reauthRequired: boolean;
}

export interface AuthDomain {
  domain: string;
  defaultAccountId: string | null;
  accounts: AuthAccount[];
}

export interface AuthStatus {
  domains: AuthDomain[];
}

export interface OAuthStart {
  flowId: string;
  verificationUrl: string;
  userCode: string;
}

export type OAuthFlowStatus = 'pending' | 'success' | 'error';

async function postAuth(path: string, body: unknown, fallback: string): Promise<AuthStatus> {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw await errorFrom(response, fallback);
  return (await response.json()) as AuthStatus;
}

export function fetchAuth(): Promise<AuthStatus> {
  return getJson<AuthStatus>('/api/auth');
}

export async function startOAuth(domain: string): Promise<OAuthStart> {
  const response = await fetch(`${BASE}/api/auth/oauth`, {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ domain }),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw await errorFrom(response, `OAuth start failed (${response.status}).`);
  return (await response.json()) as OAuthStart;
}

export function fetchOAuthStatus(flowId: string): Promise<{ status: OAuthFlowStatus; error?: string }> {
  return getJson(`/api/auth/oauth/${encodeURIComponent(flowId)}`);
}

export interface QuotaTier {
  name: string;
  utilization: number;
  resetsAt?: number;
}

export interface QuotaResponse {
  tiers: QuotaTier[];
  plan?: string;
}

export function fetchQuota(domain: string, accountId: string): Promise<QuotaResponse> {
  return getJson<QuotaResponse>(
    `/api/auth/quota?domain=${encodeURIComponent(domain)}&accountId=${encodeURIComponent(accountId)}`,
  );
}

export function setDefaultAuth(domain: string, accountId: string): Promise<AuthStatus> {
  return postAuth('/api/auth/default', { domain, accountId }, 'Could not set the default account.');
}

export function removeAuthAccount(domain: string, accountId: string): Promise<AuthStatus> {
  return postAuth('/api/auth/remove', { domain, accountId }, 'Could not remove the account.');
}

export async function setMode(workflow: string): Promise<Info> {
  const response = await fetch(`${BASE}/api/mode`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ workflow }),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Switch failed (${response.status}).`);
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
  input: { prompt: string; sessionId?: string; attachments?: string[]; loop?: { args: string } },
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

    let terminal = false;
    try {
      await consumeSse(response, (event, payload) => {
        if (event === 'done' || event === 'error') terminal = true;
        dispatch(event, payload);
      }, controller.signal);
      if (!terminal && !controller.signal.aborted) handlers.onError("Stream disconnected. The backend keeps running; synchronizing the session.");
    } catch (error) {
      if (!controller.signal.aborted) handlers.onError(error instanceof Error ? error.message : "Stream failed.");
    }
  })();

  function dispatch(event: string, payload: unknown): void {
    switch (event) {
      case "delta": {
        const delta = payload as { kind?: unknown; text?: unknown };
        if ((delta.kind === 'text' || delta.kind === 'reasoning') && typeof delta.text === 'string') handlers.onDelta?.({ kind: delta.kind, text: delta.text });
        break;
      }
      case "job": handlers.onJob?.(payload as JobUpdate); break;
      case "ask": handlers.onAsk?.(payload as QuestionRequest); break;
      case "ask_closed": handlers.onAskClosed?.((payload as { id: string }).id); break;
      case "session": {
        const id = (payload as { sessionId?: unknown }).sessionId;
        if (typeof id === "string") handlers.onSession?.(id);
        break;
      }
      case "assistant":
        handlers.onAssistant(payload as Parameters<ChatHandlers["onAssistant"]>[0]);
        break;
      case "task":
        handlers.onTask?.(payload as TaskUpdate);
        break;
      case "approval_closed":
        handlers.onApprovalClosed?.((payload as { id: string }).id);
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
      case "usage":
        handlers.onUsage?.(payload && typeof payload === 'object' ? (payload as { usage?: SessionUsage | null }).usage ?? null : null);
        break;
      case "loop":
        handlers.onLoop?.(payload as LoopStatus);
        break;
      case "session_meta":
        handlers.onSessionMeta?.();
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
