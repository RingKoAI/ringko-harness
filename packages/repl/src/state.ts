// Pure REPL state helpers (no terminal dependency, unit-testable).
import type { AgentEvent, ChatMessage } from "@ringko-ai/sdk";
import type { SessionEvent } from "@ringko-ai/session";

export interface ReplItem {
  id: number;
  kind: "user" | "assistant" | "tool" | "notice" | "thinking";
  text: string;
  toolName?: string;
  toolCallId?: string;
  arguments?: unknown;
  running?: boolean;
  incomplete?: boolean;
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
  let items: ReplItem[] = [];
  for (const message of messages) {
    if (message.role === "user") items.push(userItem(message.content));
    else if (message.role === "assistant") {
      items.push(...agentEventToItems({ type: "model", turn: 0, message }));
      for (const call of message.toolCalls ?? []) items = applyAgentEvent(items, { type: "tool_call", turn: 0, message: { role: "assistant", content: "", toolCalls: [call] } });
    } else if (message.role === "tool") items = applyAgentEvent(items, { type: message.toolCallId && failedCalls.has(message.toolCallId) ? "tool_error" : "tool", turn: 0, message });
  }
  // A restored call without a result has an unknown outcome, not an active process.
  return finishPendingTools(items);
}

/** Map one harness agent event to zero or more display items. */
export function agentEventToItems(event: AgentEvent): ReplItem[] {
  if (event.type === "tool_call") return (event.message.toolCalls ?? []).map(call => ({ id: nextId(), kind: "tool", text: "", toolName: call.name, toolCallId: call.id, arguments: call.arguments, running: true }));
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
      toolCallId: event.message.toolCallId,
      running: false,
      failed: event.type === "tool_error",
    },
  ];
}

/** Update a call in place so concurrent results keep their original call order. */
export function applyAgentEvent(items: readonly ReplItem[], event: AgentEvent): ReplItem[] {
  const next = [...items];
  for (const item of agentEventToItems(event)) {
    const index = item.kind === "tool" && item.toolCallId ? next.findIndex(existing => existing.kind === "tool" && existing.toolCallId === item.toolCallId) : -1;
    if (index < 0) next.push(item);
    else next[index] = { ...next[index], ...item, id: next[index].id, arguments: next[index].arguments ?? item.arguments };
  }
  return next;
}

/** Ending a host run cannot establish success for a call without a result. */
export function finishPendingTools(items: readonly ReplItem[]): ReplItem[] {
  return items.map(item => item.running ? { ...item, running: false, incomplete: true, text: "No recorded result." } : item);
}

/** Tools whose raw result is not shown in the UI (search noise); summarized instead. */
const QUIET_TOOLS = new Set(["glob", "grep"]);

/**
 * The UI-text for a tool result: the raw content, or a short summary for
 * search tools. Returns undefined when the raw content should be shown.
 */
export function toolResultSummary(item: ReplItem): string | undefined {
  if (item.kind !== "tool") return undefined;
  if (item.running) return "Running";
  if (item.incomplete) return "Outcome unknown";
  try {
    const parsed: unknown = JSON.parse(item.text);
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      if (typeof record.exitCode === "number" || record.exitCode === null) return `Exit ${record.exitCode ?? "unknown"}${record.timedOut === true ? " (timed out)" : ""}${record.truncated === true ? " (truncated)" : ""}`;
      if (item.failed) return truncate(item.text, 160) || "Tool failed";
      if (item.toolName && QUIET_TOOLS.has(item.toolName) && Array.isArray(record.matches)) {
        const count = record.matches.length;
        const unit = item.toolName === "glob" ? "file" : "match";
        return `${count} ${unit}${count === 1 ? "" : "s"}${record.truncated === true ? " (truncated)" : ""}`;
      }
      if (typeof record.jobId === "string") return `Background job ${truncate(record.jobId, 64)}`;
      if (typeof record.content === "string") return `${record.content.split("\n").length} lines${record.truncated === true ? " (truncated)" : ""}`;
    }
  } catch {
    // not JSON; fall through
  }
  if (item.failed) return truncate(item.text, 160) || "Tool failed";
  return item.text ? `${item.text.split("\n").length} lines of output` : "Done";
}

export function toolInputText(item: ReplItem): string | undefined {
  if (item.arguments === undefined) return undefined;
  try {
    const input = JSON.stringify(item.arguments, null, 2);
    if (input === undefined) return undefined;
    const limit = 8192;
    return input.length > limit ? `${input.slice(0, limit)}\n[Input preview truncated]` : input;
  } catch { return "[Input could not be displayed]"; }
}

export function toolOutputText(item: ReplItem): string {
  if (item.toolName === "shell") {
    try {
      const value: unknown = JSON.parse(item.text);
      if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        if (typeof record.stdout === "string" && typeof record.stderr === "string") {
          return [record.stdout, record.stderr ? `stderr:\n${record.stderr}` : ""].filter(Boolean).join("\n") || "(no output)";
        }
      }
    } catch { /* Plain-text errors remain visible. */ }
  }
  return item.text;
}

/** Identify the operation without dumping arbitrary JSON or tool output. */
export function toolCallSummary(item: ReplItem): string {
  if (typeof item.arguments !== "object" || item.arguments === null) return "";
  const args = item.arguments as Record<string, unknown>;
  for (const key of ["file_path", "path", "pattern", "command", "url", "description", "prompt"]) {
    if (typeof args[key] === "string") return truncate(args[key], 100);
  }
  return "";
}

/** Collapse a value to a single line bounded by `max` characters. */
export function truncate(text: string, max: number): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= max) return singleLine;
  return `${singleLine.slice(0, Math.max(0, max - 1))}…`;
}
