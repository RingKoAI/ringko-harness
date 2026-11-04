// HTTP-facing projections of persisted session records.

import type { ChatMessage } from "@ringko-ai/sdk";
import { sessionTitle, toChatMessages, type SessionEvent } from "@ringko-ai/session";

/**
 * Session logs keep inline image parts so a resumed run can replay them to the
 * model. HTTP clients only receive the text summary: a single screenshot would
 * otherwise add megabytes to every snapshot and trajectory response.
 */
export function stripMessageParts(message: ChatMessage): ChatMessage {
  if (!message.parts) return message;
  const { parts: _parts, ...rest } = message;
  return rest as ChatMessage;
}

export function stripEventParts(event: SessionEvent): SessionEvent {
  const data = event.data;
  if (typeof data !== "object" || data === null || Array.isArray(data) || !("parts" in data)) return event;
  const { parts: _parts, ...rest } = data as Record<string, unknown>;
  return { ...event, data: rest };
}

/** A session's title, or its first user message truncated as a fallback. */
export function sessionTitleView(events: readonly SessionEvent[]): string | null {
  const recorded = sessionTitle(events);
  if (recorded && recorded.trim().length > 0) return recorded;
  const firstUser = toChatMessages(events).find((message) => message.role === "user");
  const text = firstUser?.content.trim();
  return text && text.length > 0 ? text.slice(0, 60) : null;
}
