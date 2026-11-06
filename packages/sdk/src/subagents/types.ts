import type {
  AccessMode,
  AgentEvent,
  ApprovalHandler,
  JobManager,
  ModelClient,
  ToolRegistry,
} from "@ringko-ai/harness";
import type { SessionStore } from "@ringko-ai/session";

export type SubagentMode = "read" | "write" | "full";
export type SubagentStatus = "running" | "completed" | "failed" | "cancelled" | "unknown";
export type SubagentStopReason = "completed" | "aborted" | "cancelled" | "error" | "turn_limit" | "timeout" | "refusal" | "max_tokens";

export interface SubagentCapabilities {
  /** Accepts follow-up prompts after its first turn. */
  continuable: boolean;
  /** Can cold-resume from a persisted session after the parent restarts. */
  resume: boolean;
  /** Accepts a model override at start. */
  modelSelection: boolean;
  /** Can use the parent's workspace tools under the requested mode. */
  tools: boolean;
  /** Inherits the parent's approval gate. */
  approvals: boolean;
}

export interface SubagentProviderDescriptor {
  name: string;
  kind: string;
  description: string;
  capabilities: SubagentCapabilities;
}

export interface SubagentResult {
  childId: string;
  provider: string;
  status: "completed" | "failed" | "cancelled";
  content: string;
  stopReason: SubagentStopReason;
  turns?: number;
  truncated?: boolean;
  diagnostic?: string;
  /** Provider-owned opaque data, such as a native session id. */
  metadata?: Record<string, unknown>;
}

export interface SubagentTaskResult {
  taskId: string;
  mode: SubagentMode;
  model: string;
  provider: string;
  status: "completed";
  content: string;
  turns: number;
  truncated: boolean;
  stopReason: "completed";
}

export interface SubagentCatalogEntry {
  childId: string;
  provider: string;
  description: string;
  mode: SubagentMode;
  model?: string;
  status: SubagentStatus;
  startedAt: number;
  completedAt: number | null;
  parentCallId: string | null;
  resumable: boolean;
  sessionId?: string;
  cwd: string;
  content?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export type SubagentEventType = "started" | "agent" | "message" | "status" | "completed" | "failed" | "cancelled";

export interface SubagentEvent {
  childId: string;
  provider: string;
  type: SubagentEventType;
  time: number;
  /** Raw child-agent event for in-process providers. */
  agentEvent?: AgentEvent;
  /** A user or assistant message crossing the child boundary. */
  message?: { role: "user" | "assistant"; content: string };
  /** Per-turn lifecycle for continuable children. */
  status?: "running" | "completed" | "failed" | "cancelled";
  /** Provider metadata discovered during the run, such as a native session id. */
  metadata?: Record<string, unknown>;
  result?: SubagentResult;
}

/** Parent-facing event, kept in the historical `task/*` namespace. */
export interface SubagentTaskEvent {
  taskId: string;
  parentCallId: string | null;
  description: string;
  mode: SubagentMode;
  model: string;
  provider: string;
  type: "started" | "event" | "message" | "status" | "completed" | "failed" | "cancelled";
  time: number;
  event?: AgentEvent;
  message?: { role: "user" | "assistant"; content: string };
  result?: SubagentResult;
  reason?: string;
}

export interface SubagentStartInput {
  /** Reserved id (for example a job id) when the host already exposed one. */
  childId?: string;
  description: string;
  prompt: string;
  mode: SubagentMode;
  /** Registered provider name; the manager default is used when omitted. */
  provider?: string;
  /** Configured model id; requires a provider with model selection. */
  model?: string;
  /** Workspace-relative or absolute child working directory. */
  cwd?: string;
  background?: boolean;
}

export interface SubagentProviderContext {
  workspace: string;
  /** Parent session id, when the host is session-backed. */
  parentSessionId?: string;
  /** Store used for durable in-process child sessions. */
  sessionStore?: SessionStore;
  model: ModelClient;
  modelId?: string;
  models?: readonly string[];
  resolveModel?: (id: string) => Promise<ModelClient>;
  /** Parent capability registry; in-process children receive a restricted view. */
  tools: ToolRegistry;
  requestApproval?: ApprovalHandler;
  accessMode?: AccessMode;
  jobs?: JobManager;
  /** Manager-owned sink for child events. */
  onEvent?: (event: SubagentEvent) => void;
  signal?: AbortSignal;
  /** Parent tool-call id for event correlation. */
  parentCallId?: string;
}

export interface SubagentRunHandle {
  readonly childId: string;
  readonly provider: string;
  readonly sessionId?: string;
  readonly capabilities: SubagentCapabilities;
  /** Resolves with the terminal result of the first (or only) execution. */
  readonly result: Promise<SubagentResult>;
  /** Send another turn. Resolves when that turn settles. Continuable providers only. */
  send?(content: string, signal?: AbortSignal): Promise<void>;
  /** Cancel the current execution, preserving the child for a later turn. */
  interrupt?(): void;
  /** Release the child and all provider resources. */
  dispose(): Promise<void>;
}

export interface SubagentProvider {
  readonly name: string;
  readonly kind: string;
  readonly description: string;
  readonly capabilities: SubagentCapabilities;
  /** Provider-owned model allowlist; when present it replaces the host's task allowlist. */
  readonly modelIds?: readonly string[];
  available?(): boolean | Promise<boolean>;
  start(input: SubagentStartInput & { cwd: string }, context: SubagentProviderContext): Promise<SubagentRunHandle>;
  /** Reopen a persisted child and attach the current host capabilities. */
  resume?(entry: SubagentCatalogEntry, context: SubagentProviderContext): Promise<SubagentRunHandle>;
}

export interface SubagentLimits {
  maxActive: number;
  maxPerRun: number;
  maxTurns: number;
  timeoutMs: number;
  promptCharacters: number;
  descriptionCharacters: number;
  resultCharacters: number;
}

export const SUBAGENT_LIMITS: Readonly<SubagentLimits> = Object.freeze({
  maxActive: 2,
  maxPerRun: 8,
  maxTurns: 10,
  timeoutMs: 120_000,
  promptCharacters: 16_384,
  descriptionCharacters: 120,
  resultCharacters: 32_768,
});
