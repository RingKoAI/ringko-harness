// Wire contracts are platform-neutral: never import server/SDK modules into browser hosts.
export interface ServerMessage {
  role: "system" | "user" | "assistant" | "tool"; content: string; toolCallId?: string; name?: string; failed?: boolean;
  toolCalls?: Array<{ id: string; name: string; arguments: unknown }>;
  reasoning?: string; reasoningDetails?: Array<{ text: string; providerOptions?: Record<string, Record<string, unknown>> }>;
}
export interface SessionEvent { type: string; seq: number; time: number; data?: unknown; ignorable?: boolean }

export const PROTOCOL_VERSION = 1;
export const SYNC_LIMITS = {
  frameBytes: 4 * 1024 * 1024,
  subscribers: 64,
  queuedBytes: 256 * 1024,
  heartbeatMs: 15_000,
  refreshMs: 100,
  reconnectMs: 500,
  maxReconnectMs: 10_000,
  partialCharacters: 262_144,
} as const;

export interface BackendIdentity { protocol: number; instance: string; workspace: string; configPath: string | null }
export interface SessionMeta { id: string; createdAt: number; cwd: string | null; title?: string | null; summary?: string | null; archived?: boolean }
export interface Approval { id: string; toolName: string; riskLevel: "low" | "medium" | "high"; riskKind: "safe" | "workspace_file" | "workspace_write" | "external_file" | "network" | "shell"; reason: string; target: string | null }
export interface QuestionRequest { id: string; input: { questions: Array<{ id: string; question: string; header?: string; detail?: string; multiSelect?: boolean; options?: Array<{ label: string; description?: string }> }> } }
export interface QuestionOutput { answers: Array<{ id: string; selected: string[]; custom?: string }> }
export interface TodoItem { content: string; status: "pending" | "in_progress" | "completed"; activeForm?: string }
export interface SessionUsage {
  calls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  cacheHitRate: number | null;
  cacheReportedCalls: number;
  partial: boolean;
  /** Most recent recorded primary call: actual output tokens / total call time. */
  outputTokensPerSecond?: number | null;
}
export interface TaskSummary {
  taskId: string; parentCallId: string | null; description: string; mode: "read" | "write" | "full"; model?: string;
  status: "running" | "completed" | "failed" | "cancelled" | "unknown"; startedAt: number; completedAt: number | null;
  content?: string; reason?: string; activity?: string;
}
export interface JobSummary { jobId: string; kind: "sub" | "shell"; description: string; status: "running" | "completed" | "failed" | "cancelled" | "unknown"; background: boolean; lastSeq: number; result?: unknown; output?: string }
export interface LoopStatus { iteration: number; maxIterations: number; promise: string | null }
export interface SessionSnapshot {
  id: string; instance: string; revision: number; title: string | null; summary: string | null; archived: boolean;
  messages: ServerMessage[]; events: SessionEvent[];
  busy: boolean; approvals: Approval[]; questions: QuestionRequest[]; tasks: TaskSummary[]; todos: TodoItem[]; jobs: JobSummary[];
  partial: { content: string; reasoning: string } | null; loop: LoopStatus | null; error: string | null;
  usage?: SessionUsage | null;
}
export interface SyncNotice { instance: string; revision: number; sessionId?: string; kind: "session" | "activity" | "config" | "workspace" | "reset" }
export interface RunInput { sessionId: string; prompt: string; attachments?: string[]; loop?: { args: string } }
