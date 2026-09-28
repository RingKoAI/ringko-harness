import type { SessionEvent } from "./types.ts";
export interface SessionTodo { content: string; status: "pending" | "in_progress" | "completed"; activeForm?: string }
/** Restore only recorded, structurally valid bounded todo snapshots. */
export function sessionTodos(events: readonly SessionEvent[]): SessionTodo[] {
  for (const event of [...events].reverse()) {
    if (event.type !== "session/todo" || !event.data || typeof event.data !== "object") continue;
    const todos = (event.data as { todos?: unknown }).todos;
    if (!Array.isArray(todos) || todos.length > 100) continue;
    if (todos.every(item => item && typeof item.content === "string" && item.content.length <= 2048 && ["pending", "in_progress", "completed"].includes(item.status) && (item.activeForm === undefined || (typeof item.activeForm === "string" && item.activeForm.length <= 2048)))) return todos.map(item => ({ ...item }));
  }
  return [];
}
