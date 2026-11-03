import type { SessionEvent } from "./types.ts";

export type TrajectoryKind = "user" | "assistant" | "model" | "tool" | "task" | "compaction" | "session";
export interface TrajectoryRecord {
  seq: number;
  time: number;
  type: string;
  kind: TrajectoryKind;
  turn: number | null;
  label: string;
  preview: string;
  details: string;
  truncated: boolean;
  failed: boolean;
  durationMs: number | null;
  /** Set for task/subagent records; links the record to its delegated task. */
  taskId?: string;
  /** Whether the record belongs to the main agent or a delegated subagent. */
  agent?: "main" | "subagent";
}
export interface TrajectoryPage {
  records: TrajectoryRecord[];
  hasOlder: boolean;
  hasNewer: boolean;
  lastSeq: number;
}
export const TRAJECTORY_PAGE_LIMIT = 50;
export const TRAJECTORY_DETAILS_LIMIT = 32_768;
const PREVIEW_LIMIT = 160;

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Project recorded facts only; absent timing and usage are never inferred. */
export function trajectoryPage(events: readonly SessionEvent[], options: {
  limit?: number; before?: number; after?: number;
} = {}): TrajectoryPage {
  const limit = options.limit ?? TRAJECTORY_PAGE_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > TRAJECTORY_PAGE_LIMIT
    || (options.before !== undefined && (!Number.isSafeInteger(options.before) || options.before < 0))
    || (options.after !== undefined && (!Number.isSafeInteger(options.after) || options.after < 0))
    || (options.before !== undefined && options.after !== undefined)) throw new TypeError("Invalid trajectory page.");
  const candidates = events.filter(event => options.before !== undefined ? event.seq < options.before
    : options.after !== undefined ? event.seq > options.after : true);
  const selected = options.after !== undefined ? candidates.slice(0, limit) : candidates.slice(-limit);
  const durations = new Map<number, number>();
  const starts = new Map<string, number>();
  for (const event of events) {
    const data = record(event.data);
    if (typeof data.taskId === "string" && event.type.startsWith("task/")) {
      const id = `task:${data.taskId}`;
      if (event.type === "task/started") starts.set(id, event.time);
      if (["task/completed", "task/failed", "task/cancelled"].includes(event.type)) {
        const start = starts.get(id);
        if (start !== undefined && event.time >= start) durations.set(event.seq, event.time - start);
        starts.delete(id);
      }
    }
    if (typeof data.toolCallId !== "string") continue;
    if (event.type === "tool/call") starts.set(`tool:${data.toolCallId}`, event.time);
    if (event.type === "tool/result") {
      const start = starts.get(`tool:${data.toolCallId}`);
      if (start !== undefined && event.time >= start) durations.set(event.seq, event.time - start);
      starts.delete(`tool:${data.toolCallId}`);
    }
  }
  const records = selected.map((event): TrajectoryRecord => {
    const data = record(event.data);
    const isTask = event.type.startsWith("task/");
    const child = isTask && typeof data.event === "object" && data.event !== null && !Array.isArray(data.event)
      ? data.event as Record<string, unknown>
      : undefined;
    const childMessage = child && typeof child.message === "object" && child.message !== null && !Array.isArray(child.message)
      ? child.message as Record<string, unknown>
      : undefined;
    const taskId = isTask && typeof data.taskId === "string" ? data.taskId : undefined;
    const kind: TrajectoryKind = event.type === "user/message" ? "user"
      : event.type === "assistant/message" ? "assistant"
      : event.type === "model/call" || event.type === "model/usage" ? "model"
      : event.type.startsWith("tool/") ? "tool"
      : isTask ? "task"
      : event.type === "session/compaction" ? "compaction" : "session";
    const childLabel = child
      ? typeof child.toolName === "string" ? child.toolName
        : typeof child.type === "string" ? child.type : "event"
      : event.type.slice(5);
    const label = isTask
      ? `[${typeof data.mode === "string" ? data.mode : "task"}] ${typeof data.description === "string" ? data.description : "subagent"} · ${childLabel}`
      : typeof data.name === "string" ? data.name
        : typeof data.model === "string" ? data.model : event.type;
    const result = typeof data.result === "object" && data.result !== null && !Array.isArray(data.result)
      ? data.result as Record<string, unknown>
      : undefined;
    const content = typeof childMessage?.content === "string" ? childMessage.content
      : typeof data.content === "string" ? data.content
        : typeof result?.content === "string" ? result.content
          : typeof data.summary === "string" ? data.summary : typeof data.title === "string" ? data.title : label;
    const turn = typeof child?.turn === "number" && Number.isSafeInteger(child.turn) ? child.turn
      : typeof data.turn === "number" && Number.isSafeInteger(data.turn) ? data.turn : null;
    const details = JSON.stringify(event.data ?? null, null, 2);
    return {
      seq: event.seq, time: event.time, type: event.type, kind, turn,
      label: label.slice(0, PREVIEW_LIMIT), preview: content.replace(/\s+/g, " ").slice(0, PREVIEW_LIMIT),
      details: details.slice(0, TRAJECTORY_DETAILS_LIMIT), truncated: details.length > TRAJECTORY_DETAILS_LIMIT,
      failed: data.failed === true || event.type === "task/failed" || event.type === "task/cancelled", durationMs: durations.get(event.seq) ?? null,
      ...(taskId ? { taskId, agent: "subagent" as const } : { agent: "main" as const }),
    };
  });
  const first = selected[0]?.seq;
  const last = selected.at(-1)?.seq;
  return {
    records, lastSeq: events.at(-1)?.seq ?? -1,
    hasOlder: first !== undefined && events.some(event => event.seq < first),
    hasNewer: last !== undefined && events.some(event => event.seq > last),
  };
}
