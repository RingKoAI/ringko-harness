// Pure REPL state helpers (no terminal dependency, unit-testable).
import type { AgentEvent, ChatMessage } from "@ringko-ai/sdk";
import { toChatSurface, type SessionEvent } from "@ringko-ai/session";
import { restoreTranscript, type TranscriptMetadata } from "@ringko-ai/client";

export interface ReplItem extends TranscriptMetadata {
  id: number;
  kind: "user" | "assistant" | "tool" | "notice" | "thinking";
  text: string;
  toolName?: string;
  toolCallId?: string;
  arguments?: unknown;
  running?: boolean;
  incomplete?: boolean;
  unmatched?: boolean;
  failed?: boolean;
  hasToolCalls?: boolean;
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
export function messagesToItems(messages: readonly (ChatMessage & TranscriptMetadata & { failed?: boolean })[], events: readonly SessionEvent[] = [], busy = false, failed = false): ReplItem[] {
  const surface = events.length ? toChatSurface(events) : [];
  const restored = restoreTranscript(messages.map((message, index) => ({ ...message,
    sourceSeq: message.sourceSeq ?? (surface.length === messages.length ? surface[index]?.seq : undefined),
  })), events, busy, failed);
  let items: ReplItem[] = [];
  for (const message of restored) {
    const metadata: TranscriptMetadata = { ...(message.sourceSeq !== undefined ? { sourceSeq: message.sourceSeq } : {}), ...(message.runStart !== undefined ? { runStart: message.runStart } : {}), ...(message.runStatus ? { runStatus: message.runStatus } : {}) };
    if (message.role === "user") items.push({ ...userItem(message.content), ...metadata });
    else if (message.role === "assistant") {
      items.push(...agentEventToItems({ type: "model", turn: 0, message }).map(item => ({ ...item, ...metadata })));
      for (const call of message.toolCalls ?? []) items = applyAgentEvent(items, { type: "tool_call", turn: 0, message: { role: "assistant", content: "", toolCalls: [call] } }, metadata);
    } else if (message.role === "tool") items = applyAgentEvent(items, { type: message.failed ? "tool_error" : "tool", turn: 0, message }, metadata);
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
    if (event.message.content.length > 0) items.push({ id: nextId(), kind: "assistant", text: event.message.content, ...(event.message.toolCalls?.length ? { hasToolCalls: true } : {}) });
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
export function applyAgentEvent(items: readonly ReplItem[], event: AgentEvent, metadata: TranscriptMetadata = {}): ReplItem[] {
  const next = [...items];
  const user = next.findLastIndex(item => item.kind === "user");
  for (const value of agentEventToItems(event)) {
    const item = { ...value, ...metadata };
    const index = item.kind === "tool" && item.toolCallId ? next.findLastIndex((existing, index) => index > user && existing.kind === "tool" && existing.running && existing.toolCallId === item.toolCallId && (item.runStart === undefined || existing.runStart === item.runStart)) : -1;
    if (index >= 0 && event.type === "tool_call") { next[index] = { ...next[index], incomplete: true }; next.push({ ...item, incomplete: true }); }
    else if (index < 0) next.push(item.kind === "tool" && event.type !== "tool_call" ? { ...item, unmatched: true } : item);
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
      if (!item.failed && item.toolName === "tree" && typeof record.directories === "number" && typeof record.files === "number") return `${record.directories} ${record.directories === 1 ? "directory" : "directories"} · ${record.files} file${record.files === 1 ? "" : "s"}${record.truncated === true ? " (truncated)" : ""}`;
      if (typeof record.exitCode === "number" || record.exitCode === null) return `Exit ${record.exitCode ?? "unknown"}${record.timedOut === true ? " (timed out)" : ""}${record.truncated === true ? " (truncated)" : ""}`;
      if (item.failed) return truncate(item.text, 160) || "Tool failed";
      if (item.toolName && QUIET_TOOLS.has(item.toolName)) {
        const truncated = record.truncated === true ? " (truncated)" : "";
        if (Array.isArray(record.matches)) {
          const count = record.matches.length;
          const unit = item.toolName === "glob" ? "file" : "match";
          return `${count} ${unit}${count === 1 ? "" : unit === "match" ? "es" : "s"}${truncated}`;
        }
        if (Array.isArray(record.files)) {
          const count = record.files.length;
          return `${count} file${count === 1 ? "" : "s"} matched${truncated}`;
        }
        if (Array.isArray(record.counts)) {
          const count = record.counts.reduce((sum, entry) => sum + (typeof (entry as { count?: unknown }).count === "number" ? (entry as { count: number }).count : 0), 0);
          return `${count} match${count === 1 ? "" : "es"} in ${record.counts.length} file${record.counts.length === 1 ? "" : "s"}${truncated}`;
        }
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
  if (!item.failed && item.toolName === "tree") {
    try {
      const value: unknown = JSON.parse(item.text);
      if (value && typeof value === "object" && typeof (value as { tree?: unknown }).tree === "string") return (value as { tree: string }).tree;
    } catch { /* Plain-text errors remain visible. */ }
  }
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
