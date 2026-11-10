import type { SessionSnapshot } from "@ringko-ai/client";
import { toolLogEntries, lastRunStart } from "@ringko-ai/session";
import { messagesToItems, nextId, type ReplItem } from "./state.ts";
import { restoreTaskViews } from "./subagent-view.ts";

/** Snapshots replace object identities; negative display IDs stay stable within each view. */
function stableItems(items: readonly ReplItem[]): ReplItem[] {
  return items.map((item, index) => ({ ...item, id: -(index + 1) }));
}

/** A snapshot can be loaded during a running turn, not only after a completed transcript. */
export function snapshotItems(snapshot: SessionSnapshot): ReplItem[] {
  const pending = new Set(toolLogEntries(snapshot.events).filter(call => call.status === "pending").map(call => call.callId));
  const restored = messagesToItems(snapshot.messages, snapshot.events, snapshot.busy, snapshot.error !== null);
  const lastUser = restored.findLastIndex(item => item.kind === "user");
  const items = restored.map((item, index) =>
    snapshot.busy && item.toolCallId && pending.has(item.toolCallId) && (item.runStatus === "running" || (item.runStatus === undefined && index > lastUser))
      ? { ...item, running: true, incomplete: false, text: "" } : item);
  if (snapshot.partial?.reasoning) items.push({ id: nextId(), kind: "thinking", text: snapshot.partial.reasoning });
  if (snapshot.partial?.content) items.push({ id: nextId(), kind: "assistant", text: snapshot.partial.content, running: true });
  if (snapshot.error) {
    const cancelled = snapshot.events.findLast(event => ["run/started", "run/completed", "run/cancelled", "run/failed", "run/error"].includes(event.type))?.type === "run/cancelled";
    items.push({ id: nextId(), kind: cancelled ? "notice" : "assistant", text: `${cancelled ? "Run cancelled" : "Request failed"}: ${snapshot.error.split(" | ")[0]}`, failed: !cancelled, runStart: lastRunStart(snapshot.events), runStatus: cancelled ? "cancelled" : "failed" });
  }
  return stableItems(items);
}

export function snapshotTasks(snapshot: SessionSnapshot) {
  return restoreTaskViews(snapshot.events).map(view => {
    const task = snapshot.tasks.find(task => task.taskId === view.id);
    // An interrupted historical task has no terminal event. Never show it as still active.
    const stable = { ...view, items: stableItems(view.items) };
    return !snapshot.busy && view.status === "running"
      ? { ...stable, status: "cancelled" as const, reason: task?.reason ?? "No active backend run." } : stable;
  });
}
