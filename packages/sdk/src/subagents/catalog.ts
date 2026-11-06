import { lastRunStart, type SessionEvent } from "@ringko-ai/session";
import type { SubagentCatalogEntry, SubagentMode, SubagentStatus } from "./types.ts";

const MODES = new Set<SubagentMode>(["read", "write", "full"]);

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/**
 * Project the parent-owned child catalog from session events. A child whose
 * last run never settled remains `unknown` after a restart, and records from
 * an earlier run never become `running` merely because a later run is active.
 */
export function subagentCatalog(events: readonly SessionEvent[], active = false): SubagentCatalogEntry[] {
  const entries = new Map<string, SubagentCatalogEntry>();
  const runStart = active ? lastRunStart(events) : undefined;
  for (const event of events) {
    if (!event.type.startsWith("task/") || !event.data) continue;
    const data = record(event.data);
    if (!data || typeof data.taskId !== "string" || data.taskId.length === 0) continue;
    if (event.type === "task/started") {
      if (typeof data.description !== "string" || data.description.length === 0 || !MODES.has(data.mode as SubagentMode)) continue;
      const started = active && (runStart === undefined || event.seq > runStart);
      entries.set(data.taskId, {
        childId: data.taskId,
        provider: typeof data.provider === "string" ? data.provider : "in-process",
        description: data.description,
        mode: data.mode as SubagentMode,
        ...(typeof data.model === "string" ? { model: data.model } : {}),
        status: started ? "running" : "unknown",
        startedAt: event.time,
        completedAt: null,
        parentCallId: typeof data.parentCallId === "string" ? data.parentCallId : null,
        resumable: data.resumable === true,
        ...(typeof data.sessionId === "string" ? { sessionId: data.sessionId } : {}),
        cwd: typeof data.cwd === "string" ? data.cwd : "",
        ...(record(data.metadata) ? { metadata: record(data.metadata) } : {}),
      });
      continue;
    }
    const entry = entries.get(data.taskId);
    if (!entry) continue;
    if (event.type === "task/provider") {
      if (record(data.metadata)) entry.metadata = { ...entry.metadata, ...record(data.metadata) };
      if (typeof data.sessionId === "string") entry.sessionId = data.sessionId;
      if (data.resumable === true) entry.resumable = true;
      continue;
    }
    if (event.type === "task/message") {
      if (data.role === "assistant" && typeof data.content === "string") entry.content = data.content;
      continue;
    }
    if (event.type === "task/status") {
      if (["running", "completed", "failed", "cancelled"].includes(String(data.status))) {
        entry.status = data.status as SubagentStatus;
        entry.completedAt = data.status === "running" ? null : event.time;
        const result = record(data.result);
        if (result) {
          if (typeof result.content === "string") entry.content = result.content;
          if (typeof result.stopReason === "string" && result.stopReason !== "completed") entry.reason = result.stopReason;
          if (record(result.metadata)) entry.metadata = { ...entry.metadata, ...record(result.metadata) };
        }
      }
      continue;
    }
    if (!["task/completed", "task/failed", "task/cancelled"].includes(event.type)) continue;
    entry.status = event.type.slice(5) as Exclude<SubagentStatus, "running" | "unknown">;
    entry.completedAt = event.time;
    const result = record(data.result);
    if (result) {
      if (typeof result.content === "string") entry.content = result.content;
      if (typeof result.stopReason === "string" && result.stopReason !== "completed") entry.reason = result.stopReason;
      if (typeof result.reason === "string") entry.reason = result.reason;
      if (record(result.metadata)) entry.metadata = { ...entry.metadata, ...record(result.metadata) };
    } else if (typeof data.reason === "string") entry.reason = data.reason;
  }
  return [...entries.values()];
}

/** Latest catalog entries first, capped for model-facing listings. */
export function recentCatalog(entries: readonly SubagentCatalogEntry[], limit = 50): SubagentCatalogEntry[] {
  return [...entries].sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
}
