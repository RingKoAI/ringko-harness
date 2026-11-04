// Typed client for the RingKo local server (see @ringko-ai/app).
import { type TodoItem } from '@ringko-ai/client';
import { BASE, UnauthorizedError, authHeaders, backendClient, errorFrom, getJson } from './api/http';
export { UnauthorizedError, backendClient, clearToken, getToken, setToken } from './api/http';
export type { SessionSnapshot, TodoItem, SessionUsage } from '@ringko-ai/client';
import type { UsageStatistics, UsageStatisticsQuery } from '@ringko-ai/client';
export type { UsageStatistics, UsageStatisticsQuery, UsageStatisticsBucket, UsageRequest, UsageCallKind } from '@ringko-ai/client';
export * from './api/connectors';
export * from './api/sessions';
export * from './api/workspace';
export * from './api/chat';
export * from './api/settings';

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


