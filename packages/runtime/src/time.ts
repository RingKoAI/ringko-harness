// Time source: emits `time` ticks into the event log so the model can subscribe.
import type { EventLog } from "./log.ts";

export interface TimeSourceOptions {
  /** Tick interval in milliseconds (default 60s). */
  intervalMs?: number;
  /** Event topic (default "time"). */
  topic?: string;
}

/** Start emitting time ticks; returns a stop function. */
export function createTimeSource(log: EventLog, options: TimeSourceOptions = {}): () => void {
  const intervalMs = options.intervalMs && options.intervalMs > 0 ? options.intervalMs : 60_000;
  const topic = options.topic ?? "time";
  let count = 0;
  const timer = setInterval(() => {
    count += 1;
    log.append(topic, { tick: count, intervalMs, at: new Date().toISOString() });
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
