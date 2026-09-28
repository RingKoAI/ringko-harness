import type { SessionEvent } from "./types.ts";

export interface ToolLogEntry {
  id: string;
  callId: string;
  name: string;
  arguments: unknown;
  turn: number | null;
  requestedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  status: "pending" | "success" | "error";
  result: string | null;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Build a display-only call timeline from current and legacy session logs. */
export function toolLogEntries(events: readonly SessionEvent[]): ToolLogEntry[] {
  const entries: ToolLogEntry[] = [];
  const pending = new Map<string, ToolLogEntry[]>();

  function add(event: SessionEvent, callId: string, name: string, args: unknown, turn: unknown): ToolLogEntry {
    const entry: ToolLogEntry = {
      id: `${event.seq}:${entries.length}`,
      callId,
      name,
      arguments: args ?? null,
      turn: typeof turn === "number" && Number.isInteger(turn) && turn > 0 ? turn : null,
      requestedAt: event.time,
      startedAt: null,
      completedAt: null,
      status: "pending",
      result: null,
    };
    entries.push(entry);
    const queue = pending.get(callId) ?? [];
    queue.push(entry);
    pending.set(callId, queue);
    return entry;
  }

  for (const event of events) {
    const data = record(event.data);
    if (!data) continue;
    if (event.type === "assistant/message" && Array.isArray(data.toolCalls)) {
      for (const call of data.toolCalls) {
        const details = record(call);
        if (!details || typeof details.id !== "string" || typeof details.name !== "string") continue;
        add(event, details.id, details.name, details.arguments, data.turn);
      }
    } else if (event.type === "tool/call" && typeof data.toolCallId === "string") {
      const queue = pending.get(data.toolCallId);
      const entry = queue?.find((item) => item.startedAt === null);
      const current = entry ?? add(
        event,
        data.toolCallId,
        typeof data.name === "string" ? data.name : "unknown",
        data.arguments,
        data.turn,
      );
      current.startedAt = event.time;
    } else if (event.type === "tool/result" && typeof data.toolCallId === "string") {
      const queue = pending.get(data.toolCallId);
      const orphan = !queue?.length;
      const entry = queue?.shift() ?? add(
        event,
        data.toolCallId,
        typeof data.name === "string" ? data.name : "unknown",
        null,
        data.turn,
      );
      entry.completedAt = event.time;
      entry.status = data.failed === true ? "error" : "success";
      entry.result = typeof data.content === "string" ? data.content : "";
      if (orphan || queue?.length === 0) pending.delete(data.toolCallId);
    }
  }
  return entries;
}
