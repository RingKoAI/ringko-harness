import type { SessionSnapshot } from "@ringko-ai/client";
import { toolLogEntries } from "@ringko-ai/session";
import { messagesToItems, nextId, type ReplItem } from "./state.ts";
import { restoreTaskViews } from "./subagent-view.ts";

/** A snapshot can be loaded during a running turn, not only after a completed transcript. */
export function snapshotItems(snapshot: SessionSnapshot): ReplItem[] {
  const pending = new Set(toolLogEntries(snapshot.events).filter(call => call.status === "pending").map(call => call.callId));
  const items = messagesToItems(snapshot.messages, snapshot.events).map(item =>
    snapshot.busy && item.toolCallId && pending.has(item.toolCallId)
      ? { ...item, running: true, incomplete: false, text: "" } : item);
  if (snapshot.partial?.reasoning) items.push({ id: nextId(), kind: "thinking", text: snapshot.partial.reasoning });
  if (snapshot.partial?.content) items.push({ id: nextId(), kind: "assistant", text: snapshot.partial.content, running: true });
  return items;
}

export function snapshotTasks(snapshot: SessionSnapshot) {
  return restoreTaskViews(snapshot.events).map(view => {
    const task = snapshot.tasks.find(task => task.taskId === view.id);
    // An interrupted historical task has no terminal event. Never show it as still active.
    return !snapshot.busy && view.status === "running"
      ? { ...view, status: "cancelled" as const, reason: task?.reason ?? "No active backend run." } : view;
  });
}
