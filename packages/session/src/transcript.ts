// Transcript events: the mapping between the harness agent conversation and
// session-log events. The log is the source of truth; ChatMessage[] is derived.
import type { AgentEvent, ChatMessage, ModelToolCall } from "@ringko-ai/harness";
import type { SessionEvent } from "./types.ts";

export const TRANSCRIPT_EVENT = {
  user: "user/message",
  assistant: "assistant/message",
  tool: "tool/result",
  model: "session/model",
  modelCall: "model/call",
  title: "session/title",
  thinking: "session/thinking",
  archive: "session/archived",
} as const;

interface HandleLike {
  appendEvent(type: string, data?: unknown): SessionEvent;
}

export function recordUserMessage(handle: HandleLike, content: string): SessionEvent {
  return handle.appendEvent(TRANSCRIPT_EVENT.user, { content });
}

export function recordAssistantMessage(
  handle: HandleLike,
  turn: number,
  content: string,
  toolCalls: readonly ModelToolCall[],
): SessionEvent {
  return handle.appendEvent(TRANSCRIPT_EVENT.assistant, {
    turn,
    content,
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  });
}

export function recordToolResult(
  handle: HandleLike,
  turn: number,
  toolCallId: string,
  name: string,
  content: string,
  failed: boolean,
): SessionEvent {
  return handle.appendEvent(TRANSCRIPT_EVENT.tool, { turn, toolCallId, name, content, failed });
}

/** Record the session's selected model (`"<provider>/<model>"`). */
export function recordSessionModel(handle: HandleLike, model: string): SessionEvent {
  return handle.appendEvent(TRANSCRIPT_EVENT.model, { model });
}

/** Record one model invocation (the model id sent in the request). */
export function recordModelCall(handle: HandleLike, modelId: string): SessionEvent {
  return handle.appendEvent(TRANSCRIPT_EVENT.modelCall, { model: modelId });
}

/** Record a generated session title. */
export function recordSessionTitle(handle: HandleLike, title: string): SessionEvent {
  return handle.appendEvent(TRANSCRIPT_EVENT.title, { title });
}

/** Record the session's reasoning/thinking depth. */
export function recordSessionThinking(handle: HandleLike, level: string): SessionEvent {
  return handle.appendEvent(TRANSCRIPT_EVENT.thinking, { level });
}

/** Record whether the session is archived. */
export function recordSessionArchived(handle: HandleLike, archived: boolean): SessionEvent {
  return handle.appendEvent(TRANSCRIPT_EVENT.archive, { archived });
}

function lastString(events: readonly SessionEvent[], type: string, key: string): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== type) continue;
    const data = asRecord(event.data);
    const value = data?.[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

/** The session's selected model, if recorded. */
export function sessionModel(events: readonly SessionEvent[]): string | undefined {
  return lastString(events, TRANSCRIPT_EVENT.model, "model");
}

/** The session's generated title, if any. */
export function sessionTitle(events: readonly SessionEvent[]): string | undefined {
  return lastString(events, TRANSCRIPT_EVENT.title, "title");
}

/** Whether the session is archived (the latest archive event wins). */
export function sessionArchived(events: readonly SessionEvent[]): boolean {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== TRANSCRIPT_EVENT.archive) continue;
    const data = asRecord(event.data);
    if (typeof data?.archived === "boolean") return data.archived;
  }
  return false;
}

/** The session's reasoning/thinking depth, if recorded. */
export function sessionThinking(events: readonly SessionEvent[]): string | undefined {
  return lastString(events, TRANSCRIPT_EVENT.thinking, "level");
}

/** Record one harness agent event into the session log. */
export function recordAgentEvent(handle: HandleLike, event: AgentEvent): SessionEvent {
  if (event.type === "model") {
    return recordAssistantMessage(handle, event.turn, event.message.content, event.message.toolCalls ?? []);
  }
  return recordToolResult(
    handle,
    event.turn,
    event.message.toolCallId ?? "",
    event.message.name ?? "",
    event.message.content,
    event.type === "tool_error",
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseToolCalls(value: unknown): ModelToolCall[] {
  if (!Array.isArray(value)) return [];
  const calls: ModelToolCall[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record || typeof record.id !== "string" || typeof record.name !== "string") continue;
    calls.push({ id: record.id, name: record.name, arguments: record.arguments });
  }
  return calls;
}

/** Reconstruct harness chat messages from a session's events. */
export function toChatMessages(events: readonly SessionEvent[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const event of events) {
    const data = asRecord(event.data);
    if (!data) continue;
    if (event.type === TRANSCRIPT_EVENT.user) {
      messages.push({ role: "user", content: typeof data.content === "string" ? data.content : "" });
    } else if (event.type === TRANSCRIPT_EVENT.assistant) {
      const toolCalls = parseToolCalls(data.toolCalls);
      messages.push({
        role: "assistant",
        content: typeof data.content === "string" ? data.content : "",
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      });
    } else if (event.type === TRANSCRIPT_EVENT.tool) {
      messages.push({
        role: "tool",
        content: typeof data.content === "string" ? data.content : "",
        ...(typeof data.toolCallId === "string" ? { toolCallId: data.toolCallId } : {}),
        ...(typeof data.name === "string" ? { name: data.name } : {}),
      });
    }
  }
  return messages;
}
