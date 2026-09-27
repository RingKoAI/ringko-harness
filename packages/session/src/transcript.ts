// Transcript events: the mapping between the harness agent conversation and
// session-log events. The log is the source of truth; ChatMessage[] is derived.
import type { AgentEvent, ChatMessage, ModelToolCall } from "@ringko-ai/harness";
import type { SessionEvent } from "./types.ts";

export const TRANSCRIPT_EVENT = {
  user: "user/message",
  assistant: "assistant/message",
  tool: "tool/result",
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
