// Typed client for the RingKo local server (see @ringko-ai/app).
import { type TodoItem } from '@ringko-ai/client';
export { UnauthorizedError, backendClient, clearToken, getToken, setToken } from './api/http';
export type { SessionSnapshot, TodoItem, SessionUsage } from '@ringko-ai/client';
export type { UsageStatistics, UsageStatisticsQuery, UsageStatisticsBucket, UsageRequest, UsageCallKind } from '@ringko-ai/client';
export * from './api/connectors';
export * from './api/sessions';
export * from './api/workspace';
export * from './api/chat';
export * from './api/settings';
export * from './api/auth';
export * from './api/providers';
export * from './api/projects';
export * from './api/usage';

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

export interface QuotaTier {
  name: string;
  utilization: number;
  resetsAt?: number;
}

export interface QuotaResponse {
  tiers: QuotaTier[];
  plan?: string;
}

