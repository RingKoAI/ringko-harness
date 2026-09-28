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
  for (const event of events) {
    if (!event.type.startsWith("task/") || !event.data || typeof event.data !== "object") continue;
    const data = event.data as Record<string, unknown>;
    if (typeof data.taskId !== "string" || typeof data.description !== "string" || !["read", "write", "full"].includes(String(data.mode))) continue;
    if (event.type === "task/started") tasks.set(data.taskId, { taskId: data.taskId, parentCallId: typeof data.parentCallId === "string" ? data.parentCallId : null, description: data.description, mode: data.mode as TaskSummary["mode"], model: typeof data.model === "string" ? data.model : undefined, status: active ? "running" : "unknown", startedAt: event.time, completedAt: null });
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
