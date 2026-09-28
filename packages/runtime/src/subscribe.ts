// Model-facing `subscribe` tool over the runtime event log.
//
// Topics cover every producer: time ticks, job events, session/model events.
// An optional `every` turns the call into an interval subscription: a timer is
// started for that cadence and the call returns the next tick.
import { defineTool, type ToolDefinition } from "@ringko-ai/harness";
import type { EventLog, SubscribeResult } from "./log.ts";
import { createTimeSource } from "./time.ts";

export interface SubscribeInput {
  topics: string[];
  after?: number;
  waitMs?: number;
  /** Interval subscription: number (ms) or a duration string ("10s", "5m", "1h"). */
  everyMs?: number;
}

export type SubscribeOutput = SubscribeResult;

export const SUBSCRIBE_LIMITS = Object.freeze({ topics: 16, waitMs: 30_000, limit: 100, everyMs: 3_600_000 });

/** Parse `every`/`everyMs` into milliseconds, or undefined when invalid. */
export function parseDuration(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 100 && value <= SUBSCRIBE_LIMITS.everyMs ? value : undefined;
  }
  if (typeof value === "string") {
    const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value.trim().toLowerCase());
    if (!match) return undefined;
    const amount = Number(match[1]);
    const unit = match[2];
    const factor = unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "m" ? 60_000 : 3_600_000;
    const ms = amount * factor;
    return ms >= 100 && ms <= SUBSCRIBE_LIMITS.everyMs ? ms : undefined;
  }
  return undefined;
}

function parseSubscribe(value: unknown): SubscribeInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected an object input.");
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.topics) || record.topics.length === 0 || record.topics.length > SUBSCRIBE_LIMITS.topics) {
    throw new TypeError("Expected a non-empty 'topics' array.");
  }
  const topics: string[] = [];
  for (const topic of record.topics) {
    if (typeof topic !== "string" || topic.trim().length === 0) throw new TypeError("Each topic must be a non-empty string.");
    topics.push(topic.trim());
  }
  if (record.after !== undefined && (typeof record.after !== "number" || !Number.isInteger(record.after) || record.after < -1)) {
    throw new TypeError("'after' must be an integer >= -1.");
  }
  if (record.waitMs !== undefined && (typeof record.waitMs !== "number" || !Number.isFinite(record.waitMs) || record.waitMs < 0)) {
    throw new TypeError("'waitMs' must be a non-negative number.");
  }
  let everyMs: number | undefined;
  if (record.every !== undefined || record.everyMs !== undefined) {
    everyMs = parseDuration(record.every ?? record.everyMs);
    if (everyMs === undefined) {
      throw new TypeError("'every' must be a duration like \"10s\"/\"5m\"/\"1h\" or a millisecond number (100..3600000).");
    }
  }
  return {
    topics,
    ...(typeof record.after === "number" ? { after: record.after } : {}),
    ...(typeof record.waitMs === "number" ? { waitMs: Math.min(record.waitMs, SUBSCRIBE_LIMITS.waitMs) } : {}),
    ...(everyMs !== undefined ? { everyMs } : {}),
  };
}

export interface SubscribeToolOptions {
  name?: string;
}

export function createSubscribeTool(log: EventLog, options: SubscribeToolOptions = {}): ToolDefinition<SubscribeInput, SubscribeOutput> {
  const name = options.name ?? "subscribe";
  // One running timer per requested cadence; shared by all interval subscribers.
  const timers = new Map<number, () => void>();
  const ensureTimer = (intervalMs: number): void => {
    if (timers.has(intervalMs)) return;
    timers.set(intervalMs, createTimeSource(log, { intervalMs, topic: "time" }));
  };

  return defineTool<SubscribeInput, SubscribeOutput>({
    name,
    concurrency: "exclusive",
    description:
      'Subscribe to runtime events by topic: "time" ticks, "job" events, or "session" (model/tool) events. Reads events after a cursor; pass waitMs to long-poll. Pass every (e.g. "10s") for an interval subscription that returns the next tick. Returns the events, the latest sequence (use it as the next "after"), and whether events were missed.',
    inputSchema: {
      type: "object",
      properties: {
        topics: { type: "array", items: { type: "string" } },
        after: { type: "number" },
        waitMs: { type: "number" },
        every: { anyOf: [{ type: "number" }, { type: "string" }], description: 'Interval: ms or duration like "10s".' },
      },
      required: ["topics"],
      additionalProperties: false,
    },
    parseInput: parseSubscribe,
    assessRisk() {
      return { kind: "safe", reason: "Read runtime events." };
    },
    async execute(input, context) {
      if (input.everyMs !== undefined) ensureTimer(input.everyMs);
      const waitMs = input.waitMs !== undefined
        ? input.waitMs
        : input.everyMs !== undefined
          ? input.everyMs + 1000
          : undefined;
      const result = await log.subscribe({
        topics: input.topics,
        ...(input.after !== undefined ? { after: input.after } : {}),
        ...(waitMs !== undefined ? { waitMs } : {}),
        limit: SUBSCRIBE_LIMITS.limit,
      });
      context?.signal?.throwIfAborted();
      return result;
    },
  });
}
