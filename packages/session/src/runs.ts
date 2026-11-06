import type { SessionEvent } from "./types.ts";

/**
 * Sequence of the newest run start. Summaries use it to keep records from an
 * interrupted earlier run from appearing "running" during a later run.
 */
export function lastRunStart(events: readonly SessionEvent[]): number | undefined {
  let start: number | undefined;
  for (const event of events) {
    if (event.type === "run/started" && Number.isSafeInteger(event.seq)) start = event.seq;
  }
  return start;
}
