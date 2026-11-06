import { lastRunStart } from "./runs.ts";
import type { SessionEvent } from "./types.ts";

export interface TaskSummary {
  taskId: string;
  parentCallId: string | null;
  description: string;
  mode: "read" | "write" | "full";
  model?: string;
  status: "running" | "completed" | "failed" | "cancelled" | "unknown";
  startedAt: number;
  completedAt: number | null;
  content?: string;
  reason?: string;
}
/** Project facts from task events. Incomplete historical work has unknown outcome. */
export function taskSummaries(events: readonly SessionEvent[], active = false): TaskSummary[] {
  const tasks = new Map<string, TaskSummary>();
  const runStart = active ? lastRunStart(events) : undefined;
  for (const event of events) {
    if (!event.type.startsWith("task/") || !event.data || typeof event.data !== "object") continue;
    const data = event.data as Record<string, unknown>;
    if (typeof data.taskId !== "string") continue;
    if (event.type === "task/status") {
      const task = tasks.get(data.taskId);
      if (task && ["running", "completed", "failed", "cancelled"].includes(String(data.status))) {
        task.status = data.status as TaskSummary["status"];
        task.completedAt = data.status === "running" ? null : event.time;
      }
      continue;
    }
    if (event.type === "task/message") {
      const task = tasks.get(data.taskId);
      if (task && data.role === "assistant" && typeof data.content === "string") task.content = data.content;
      continue;
    }
    if (event.type === "task/started") {
      if (typeof data.description !== "string" || !["read", "write", "full"].includes(String(data.mode))) continue;
      tasks.set(data.taskId, { taskId: data.taskId, parentCallId: typeof data.parentCallId === "string" ? data.parentCallId : null, description: data.description, mode: data.mode as TaskSummary["mode"], model: typeof data.model === "string" ? data.model : undefined, status: active && (runStart === undefined || event.seq > runStart) ? "running" : "unknown", startedAt: event.time, completedAt: null });
      continue;
    }
    const task = tasks.get(data.taskId);
    if (!task || !["task/completed", "task/failed", "task/cancelled"].includes(event.type)) continue;
    task.status = event.type.slice(5) as "completed" | "failed" | "cancelled";
    task.completedAt = event.time;
    if (typeof data.reason === "string") task.reason = data.reason;
    const result = data.result as { content?: unknown } | null;
    if (typeof result?.content === "string") task.content = result.content;
  }
  return [...tasks.values()];
}
