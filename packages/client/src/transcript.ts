/** Presentation-only turn identity and lifecycle shared by browser and terminal hosts. */
export type TranscriptRunStatus = "running" | "completed" | "cancelled" | "failed" | "interrupted";
export interface TranscriptMetadata {
  sourceSeq?: number;
  runStart?: number;
  runStatus?: TranscriptRunStatus;
  /** Client-owned identity retained when an optimistic input is hydrated. */
  viewId?: string;
}
export type ToolActivityKind = "read" | "search" | "write" | "commands" | "subtasks" | "plan" | "tools";
export function toolActivityKind(name: string): ToolActivityKind {
  if (name === "read" || name === "tree") return "read";
  if (name === "glob" || name === "grep") return "search";
  if (name === "write" || name === "edit") return "write";
  if (name === "shell" || name === "terminal") return "commands";
  if (name === "task" || name === "job" || name === "subscribe") return "subtasks";
  if (name === "plan" || name === "update_plan") return "plan";
  return "tools";
}
interface EventLike { type: string; seq: number; data?: unknown }
interface Run { start: number; explicit: boolean; user: boolean; shell: boolean; result: boolean; failed: boolean; status?: TranscriptRunStatus }
const MESSAGE_EVENTS = new Set(["user/message", "assistant/message", "tool/result", "session/notification"]);

/** Rebuild UI lifecycle from durable events without changing model messages or session data. */
export function restoreTranscript<T extends TranscriptMetadata & { role: string; toolCallId?: string; failed?: boolean }>(messages: readonly T[], events: readonly EventLike[], busy = false, failed = false): Array<T & TranscriptMetadata> {
  const owners = new Map<number, Run>(), byId = new Map<string, Run>(), runs: Run[] = [];
  const failures = new Map<number, boolean>(), legacyFailures = new Set<string>();
  let current: Run | undefined;
  for (const event of events) {
    const data = event.data && typeof event.data === "object" && !Array.isArray(event.data) ? event.data as Record<string, unknown> : undefined;
    if (event.type === "run/started") {
      current = { start: event.seq, explicit: true, user: false, shell: data?.kind === "shell", result: false, failed: false }; runs.push(current);
      if (typeof data?.runId === "string") byId.set(data.runId, current);
    } else if (["run/completed", "run/cancelled", "run/failed", "run/error"].includes(event.type)) {
      const run = typeof data?.runId === "string" ? byId.get(data.runId) : current;
      if (run) run.status = event.type === "run/completed" ? "completed" : event.type === "run/cancelled" ? "cancelled" : "failed";
    }
    if (event.type === "user/message") {
      // An open explicit run (`run/started` without a terminal event) owns any
      // mid-run steered user messages; implicit legacy runs split per user input.
      if (!current || (current.user && (!current.explicit || Boolean(current.status)))) {
        current = { start: event.seq, explicit: false, user: false, shell: false, result: false, failed: false };
        runs.push(current);
      }
      current.user = true;
    }
    if (MESSAGE_EVENTS.has(event.type) && current) owners.set(event.seq, current);
    if (event.type === "tool/result") {
      failures.set(event.seq, data?.failed === true);
      if (data?.failed === true && typeof data.toolCallId === "string") legacyFailures.add(data.toolCallId);
      if (current) { current.result = true; current.failed ||= data?.failed === true; }
    }
  }
  for (const run of runs) {
    if (run.status) continue;
    if (busy && run === current) run.status = "running";
    else if (run.shell && run.result) run.status = run.failed ? "failed" : "completed";
    else if (run.explicit) run.status = "interrupted";
  }
  if (failed && current?.user && current.status !== "cancelled") current.status = "failed";
  return messages.map(message => {
    const run = message.sourceSeq === undefined ? undefined : owners.get(message.sourceSeq);
    const failed = message.sourceSeq === undefined ? message.failed === true || Boolean(message.toolCallId && legacyFailures.has(message.toolCallId)) : failures.get(message.sourceSeq) ?? message.failed;
    return { ...message, ...(run ? { runStart: run.start, ...(run.status ? { runStatus: run.status } : {}) } : {}), ...(message.role === "tool" ? { failed } : {}) };
  });
}

export interface TranscriptTurn {
  start: number;
  end: number;
  userIndex?: number;
  runStart?: number;
  status?: TranscriptRunStatus;
}
/** A user input owns all subsequent model/tool steps until the next input or recorded run. */
export function transcriptTurns(entries: readonly (TranscriptMetadata & { role: string })[]): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  let turn: TranscriptTurn | undefined;
  entries.forEach((entry, index) => {
    const boundary = entry.role === "user" || (entry.runStart !== undefined && turn?.runStart !== undefined && entry.runStart !== turn.runStart);
    if (!turn || boundary) { turn = { start: index, end: index }; turns.push(turn); }
    turn.end = index + 1;
    if (entry.role === "user") turn.userIndex = index;
    if (entry.runStart !== undefined) turn.runStart = entry.runStart;
    if (entry.runStatus !== undefined) turn.status = entry.runStatus;
  });
  return turns;
}
