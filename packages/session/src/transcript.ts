// Transcript events: the mapping between the harness agent conversation and
// session-log events. The log is the source of truth; ChatMessage[] is derived.
import type { AgentEvent, ChatMessage, MessagePart, ModelToolCall, ReasoningDetail } from "@ringko-ai/harness";
import { compactionSummaryContent, type SurfaceNode } from "./compaction.ts";
import type { SessionEvent } from "./types.ts";

export const TRANSCRIPT_EVENT = {
  user: "user/message",
  assistant: "assistant/message",
  toolCall: "tool/call",
  tool: "tool/result",
  model: "session/model",
  modelCall: "model/call",
  title: "session/title",
  summary: "session/summary",
  thinking: "session/thinking",
  archive: "session/archived",
  compaction: "session/compaction",
  feedback: "session/feedback",
  instructions: "session/instructions",
} as const;

export const FEEDBACK_VALUES = ["up", "down"] as const;
export type FeedbackValue = (typeof FEEDBACK_VALUES)[number];

interface HandleLike {
  appendEvent(type: string, data?: unknown): SessionEvent;
}

export function recordUserMessage(handle: HandleLike, content: string): SessionEvent {
  return handle.appendEvent(TRANSCRIPT_EVENT.user, { content });
}

export function recordInstructions(handle: HandleLike, content: string): SessionEvent {
  return handle.appendEvent(TRANSCRIPT_EVENT.instructions, { content });
}

export function recordAssistantMessage(
  handle: HandleLike,
  turn: number,
  content: string,
  toolCalls: readonly ModelToolCall[],
  reasoningDetails?: readonly ReasoningDetail[],
): SessionEvent {
  return handle.appendEvent(TRANSCRIPT_EVENT.assistant, {
    turn,
    content,
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    ...(reasoningDetails && reasoningDetails.length > 0 ? { reasoningDetails } : {}),
  });
}

export function recordToolResult(
  handle: HandleLike,
  turn: number,
  toolCallId: string,
  name: string,
  content: string,
  failed: boolean,
  parts?: readonly MessagePart[],
): SessionEvent {
  const safeParts = sanitizeParts(parts);
  return handle.appendEvent(TRANSCRIPT_EVENT.tool, {
    turn,
    toolCallId,
    name,
    content,
    failed,
    ...(safeParts ? { parts: safeParts } : {}),
  });
}

/** Bounds for structured parts persisted in the session log. */
const MAX_TOOL_PARTS = 8;
const MAX_PART_TEXT_CHARACTERS = 1_000_000;
const MAX_IMAGE_DATA_CHARACTERS = 8_000_000;
const MESSAGE_IMAGE_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/** Re-validate parts read from an event or supplied by a host. */
function sanitizeParts(value: unknown): MessagePart[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TOOL_PARTS) return undefined;
  const parts: MessagePart[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const part = item as Record<string, unknown>;
    if (part.type === "text") {
      if (typeof part.text !== "string" || part.text.length > MAX_PART_TEXT_CHARACTERS) continue;
      parts.push({ type: "text", text: part.text });
    } else if (part.type === "image") {
      if (typeof part.mediaType !== "string" || !MESSAGE_IMAGE_TYPES.has(part.mediaType)) continue;
      if (typeof part.data !== "string" || part.data.length === 0 || part.data.length > MAX_IMAGE_DATA_CHARACTERS || !BASE64_PATTERN.test(part.data)) continue;
      parts.push({ type: "image", mediaType: part.mediaType, data: part.data });
    }
  }
  return parts.length > 0 ? parts : undefined;
}

/** Record the call immediately before the tool can execute. */
export function recordToolCall(handle: HandleLike, turn: number, call: ModelToolCall): SessionEvent {
  return handle.appendEvent(TRANSCRIPT_EVENT.toolCall, {
    turn,
    toolCallId: call.id,
    name: call.name,
    arguments: call.arguments,
  });
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

/** Record a generated session summary (one or two sentences about the conversation). */
export function recordSessionSummary(handle: HandleLike, summary: string): SessionEvent {
  return handle.appendEvent(TRANSCRIPT_EVENT.summary, { summary });
}

/** Record the session's reasoning/thinking depth. */
export function recordSessionThinking(handle: HandleLike, level: string): SessionEvent {
  return handle.appendEvent(TRANSCRIPT_EVENT.thinking, { level });
}

/** Record a user's rating for a transcript message (by index); null clears it. */
export function recordFeedback(handle: HandleLike, index: number, value: FeedbackValue | null): SessionEvent {
  return handle.appendEvent(TRANSCRIPT_EVENT.feedback, { index, value });
}

/** The latest rating per transcript message index. */
export function sessionFeedback(events: readonly SessionEvent[]): Record<number, FeedbackValue> {
  const result: Record<number, FeedbackValue> = {};
  for (const event of events) {
    if (event.type !== TRANSCRIPT_EVENT.feedback) continue;
    const data = asRecord(event.data);
    if (!data || typeof data.index !== "number") continue;
    if (data.value === "up" || data.value === "down") result[data.index] = data.value;
    else delete result[data.index];
  }
  return result;
}

/** Record whether the session is archived. */
export function recordSessionArchived(handle: HandleLike, archived: boolean): SessionEvent {
  return handle.appendEvent(TRANSCRIPT_EVENT.archive, { archived });
}

/**
 * Record a compaction. `shadowedSeqs` names the current surface nodes replaced
 * by the summary; replay removes exactly those nodes and inserts the summary at
 * their position. Events without it predate replacement-aware replay and keep
 * the legacy restart-from-summary behavior.
 */
export function recordSessionCompaction(handle: HandleLike, summary: string, shadowedSeqs?: readonly number[]): SessionEvent {
  return handle.appendEvent(TRANSCRIPT_EVENT.compaction, {
    summary,
    ...(shadowedSeqs && shadowedSeqs.length > 0 ? { shadowedSeqs: [...shadowedSeqs] } : {}),
  });
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

/** The session's generated summary, if any. */
export function sessionSummary(events: readonly SessionEvent[]): string | undefined {
  return lastString(events, TRANSCRIPT_EVENT.summary, "summary");
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
    return recordAssistantMessage(handle, event.turn, event.message.content, event.message.toolCalls ?? [], event.message.reasoningDetails);
  }
  if (event.type === "tool_call") {
    const call = event.message.toolCalls?.[0];
    if (!call) throw new TypeError("Tool call event is missing its call.");
    return recordToolCall(handle, event.turn, call);
  }
  return recordToolResult(
    handle,
    event.turn,
    event.message.toolCallId ?? "",
    event.message.name ?? "",
    event.message.content,
    event.type === "tool_error",
    event.message.parts,
  );
}

/** Mark calls left without a result by an interrupted process with appropriate status. */
export function repairInterruptedToolCalls(handle: HandleLike & { all(): readonly SessionEvent[] }): number {
  const pending = new Map<string, { turn: number; name: string; started: boolean }>();
  for (const event of handle.all()) {
    const data = asRecord(event.data);
    if (!data) continue;
    if (event.type === TRANSCRIPT_EVENT.assistant) {
      for (const call of parseToolCalls(data.toolCalls)) {
        pending.set(call.id, { turn: typeof data.turn === "number" ? data.turn : 0, name: call.name, started: false });
      }
    } else if (event.type === TRANSCRIPT_EVENT.toolCall) {
      if (typeof data.toolCallId === "string") {
        const pendingCall = pending.get(data.toolCallId);
        if (pendingCall) pendingCall.started = true;
      }
    } else if (event.type === TRANSCRIPT_EVENT.tool) {
      if (typeof data.toolCallId === "string") pending.delete(data.toolCallId);
    }
  }
  for (const [id, call] of pending) {
    recordToolResult(
      handle,
      call.turn,
      id,
      call.name,
      call.started
        ? "Tool outcome unknown after interruption. Check the external state before retrying an operation with side effects."
        : "Tool was not started before the run was interrupted.",
      true,
    );
  }
  return pending.size;
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

function parseReasoningDetails(value: unknown): ReasoningDetail[] {
  if (!Array.isArray(value)) return [];
  const details: ReasoningDetail[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record || typeof record.text !== "string") continue;
    const providerOptions = asRecord(record.providerOptions);
    details.push({
      text: record.text,
      ...(providerOptions ? { providerOptions: providerOptions as Record<string, Record<string, unknown>> } : {}),
    });
  }
  return details;
}

/**
 * Reconstruct the current model surface, carrying each message's log seq so a
 * later replacement can remove exactly the nodes it summarized.
 */
export function toChatSurface(events: readonly SessionEvent[]): SurfaceNode[] {
  let nodes: SurfaceNode[] = [];
  for (const event of events) {
    const data = asRecord(event.data);
    if (!data) continue;
    if (event.type === TRANSCRIPT_EVENT.compaction) {
      const summary = typeof data.summary === "string" ? data.summary : "";
      const shadowed = Array.isArray(data.shadowedSeqs)
        ? data.shadowedSeqs.filter((seq): seq is number => typeof seq === "number")
        : undefined;
      if (shadowed === undefined) {
        // Legacy event: no replacement span was recorded, so resume starts here.
        nodes = summary.length > 0 ? [{ seq: event.seq, message: { role: "system", content: summary }, summary: true }] : [];
        continue;
      }
      const removed = new Set(shadowed);
      const replaced: SurfaceNode[] = [];
      let inserted = false;
      for (const node of nodes) {
        if (!removed.has(node.seq)) {
          replaced.push(node);
        } else if (!inserted && summary.length > 0) {
          replaced.push({ seq: event.seq, message: { role: "system", content: compactionSummaryContent(summary) }, summary: true });
          inserted = true;
        }
      }
      if (!inserted && summary.length > 0) {
        replaced.push({ seq: event.seq, message: { role: "system", content: compactionSummaryContent(summary) }, summary: true });
      }
      nodes = replaced;
      continue;
    }
    if (event.type === "session/notification" && typeof data.content === "string") {
      nodes.push({ seq: event.seq, message: { role: "system", content: data.content } });
    } else if (event.type === TRANSCRIPT_EVENT.user) {
      nodes.push({ seq: event.seq, message: { role: "user", content: typeof data.content === "string" ? data.content : "" } });
    } else if (event.type === TRANSCRIPT_EVENT.assistant) {
      const toolCalls = parseToolCalls(data.toolCalls);
      const reasoningDetails = parseReasoningDetails(data.reasoningDetails);
      nodes.push({
        seq: event.seq,
        message: {
          role: "assistant",
          content: typeof data.content === "string" ? data.content : "",
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
          ...(reasoningDetails.length > 0
            ? { reasoningDetails, reasoning: reasoningDetails.map((detail) => detail.text).join("") }
            : {}),
        },
      });
    } else if (event.type === TRANSCRIPT_EVENT.tool) {
      const parts = sanitizeParts(data.parts);
      nodes.push({
        seq: event.seq,
        message: {
          role: "tool",
          content: typeof data.content === "string" ? data.content : "",
          ...(parts ? { parts } : {}),
          ...(typeof data.toolCallId === "string" ? { toolCallId: data.toolCallId } : {}),
          ...(typeof data.name === "string" ? { name: data.name } : {}),
        },
      });
    }
  }
  return nodes;
}

/** Reconstruct harness chat messages from a session's events. */
export function toChatMessages(events: readonly SessionEvent[]): ChatMessage[] {
  return toChatSurface(events).map(node => node.message);
}
