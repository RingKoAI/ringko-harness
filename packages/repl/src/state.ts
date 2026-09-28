// Pure REPL state helpers (no terminal dependency, unit-testable).
import type { AgentEvent, ChatMessage } from "@ringko-ai/sdk";
import type { SessionEvent } from "@ringko-ai/session";

export interface ReplItem {
  id: number;
  kind: "user" | "assistant" | "tool" | "notice" | "thinking";
  text: string;
  toolName?: string;
  failed?: boolean;
}

let counter = 0;

export function nextId(): number {
  return (counter += 1);
}

export function userItem(text: string): ReplItem {
  return { id: nextId(), kind: "user", text };
}

export function noticeItem(text: string): ReplItem {
  return { id: nextId(), kind: "notice", text };
}

/** Restore visible messages as well as the model's context on session resume. */
export function messagesToItems(messages: readonly ChatMessage[], events: readonly SessionEvent[] = []): ReplItem[] {
  const failedCalls = new Set(events.filter(event => event.type === "tool/result")
    .flatMap(event => {
      const data = event.data as { failed?: unknown; toolCallId?: unknown } | null;
      return data?.failed === true && typeof data.toolCallId === "string" ? [data.toolCallId] : [];
    }));
  return messages.flatMap(message => {
    if (message.role === "user") return [userItem(message.content)];
    if (message.role === "assistant") return [{ id: nextId(), kind: "assistant" as const, text: message.content }];
    if (message.role === "tool") return [{ id: nextId(), kind: "tool" as const, text: message.content, toolName: message.name, failed: message.toolCallId ? failedCalls.has(message.toolCallId) : false }];
    return [];
  });
}

/** Map one harness agent event to zero or more display items. */
export function agentEventToItems(event: AgentEvent): ReplItem[] {
  if (event.type === "tool_call") return [];
  if (event.type === "model") {
    const items: ReplItem[] = [];
    if (event.message.reasoning) items.push({ id: nextId(), kind: "thinking", text: event.message.reasoning });
    if (event.message.content.length > 0) items.push({ id: nextId(), kind: "assistant", text: event.message.content });
    return items;
  }
  return [
    {
      id: nextId(),
      kind: "tool",
      text: event.message.content,
      toolName: event.message.name,
      failed: event.type === "tool_error",
    },
  ];
}

/** Tools whose raw result is not shown in the UI (search noise); summarized instead. */
const QUIET_TOOLS = new Set(["glob", "grep"]);

/**
 * The UI-text for a tool result: the raw content, or a short summary for
 * search tools. Returns undefined when the raw content should be shown.
 */
export function toolResultSummary(item: ReplItem): string | undefined {
  if (item.kind !== "tool" || !item.toolName || !QUIET_TOOLS.has(item.toolName)) return undefined;
  try {
    const parsed: unknown = JSON.parse(item.text);
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as { matches?: unknown; truncated?: unknown };
      if (Array.isArray(record.matches)) {
        const count = record.matches.length;
        const unit = item.toolName === "glob" ? "file" : "match";
        return `${count} ${unit}${count === 1 ? "" : "s"}${record.truncated === true ? " (truncated)" : ""}`;
      }
    }
  } catch {
    // not JSON; fall through
  }
  return "done";
}

/** Collapse a value to a single line bounded by `max` characters. */
export function truncate(text: string, max: number): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= max) return singleLine;
  return `${singleLine.slice(0, Math.max(0, max - 1))}…`;
}
