// Pure REPL state helpers (no terminal dependency, unit-testable).
import type { AgentEvent } from "@ringko-ai/sdk";

export interface ReplItem {
  id: number;
  kind: "user" | "assistant" | "tool" | "notice";
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

/** Map one harness agent event to zero or more display items. */
export function agentEventToItems(event: AgentEvent): ReplItem[] {
  if (event.type === "model") {
    const text = event.message.content;
    if (text.length === 0) return [];
    return [{ id: nextId(), kind: "assistant", text }];
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

/** Collapse a value to a single line bounded by `max` characters. */
export function truncate(text: string, max: number): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= max) return singleLine;
  return `${singleLine.slice(0, Math.max(0, max - 1))}…`;
}
