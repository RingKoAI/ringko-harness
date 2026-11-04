// Chat streaming, task, job and question endpoints.

import { consumeSse, type TodoItem, type SessionUsage } from "@ringko-ai/client";
import { BASE, UnauthorizedError, authHeaders, getJson } from "./http";
import type { Approval, ServerMessage, ToolCall } from "../api";

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
