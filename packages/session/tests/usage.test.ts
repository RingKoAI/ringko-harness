import { describe, expect, it } from "bun:test";
import { recordSessionUsage, sessionUsage } from "../src/usage.ts";
import type { SessionEvent } from "../src/types.ts";

function history(...usages: unknown[]) {
  const events: SessionEvent[] = [];
  const target = { appendEvent(type: string, data?: unknown) { const event = { seq: events.length, time: events.length, type, data }; events.push(event); return event; } };
  for (const usage of usages) recordSessionUsage(target, usage, "Fixture/model");
  return events;
}

describe("session reported usage", () => {
  it("sums actual tokens and computes a weighted cache ratio without double-counting cached input", () => {
    expect(sessionUsage(history({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 60, cacheWriteTokens: 20 }, { inputTokens: 300, outputTokens: 30, cacheReadTokens: 140 }))).toEqual({
      calls: 2, inputTokens: 400, outputTokens: 50, totalTokens: 450,
      cacheReadTokens: 200, cacheWriteTokens: 20, cacheHitRate: 0.5, cacheReportedCalls: 2, partial: false,
    });
  });

  it("distinguishes missing cache fields from explicitly reported zero cache hits", () => {
    expect(sessionUsage(history({ inputTokens: 100, outputTokens: 20 }))?.cacheHitRate).toBeNull();
    expect(sessionUsage(history({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 0 }))?.cacheHitRate).toBe(0);
    expect(sessionUsage(history({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }))).toMatchObject({ totalTokens: 0, cacheHitRate: null });
    expect(sessionUsage([])).toBeNull();
  });

  it("does not treat unsupported-cache requests as misses in the cache denominator", () => {
    const usage = sessionUsage(history({ inputTokens: 100, outputTokens: 10, cacheReadTokens: 80 }, { inputTokens: 900, outputTokens: 10 }));
    expect(usage).toMatchObject({ inputTokens: 1000, cacheReadTokens: 80, cacheHitRate: 0.8, cacheReportedCalls: 1 });
  });

  it("ignores malformed data and never manufactures total or cache values", () => {
    const usage = sessionUsage(history({ inputTokens: -1, outputTokens: 7, cacheReadTokens: "6" }, { inputTokens: 100, cacheReadTokens: 101 }));
    expect(usage).toMatchObject({ inputTokens: 100, outputTokens: 7, cacheReadTokens: null, cacheHitRate: null, partial: true });
    expect(sessionUsage(history({ inputTokens: Infinity }))).toBeNull();
  });

  it("preserves counts across compaction and fails unknown on numeric overflow", () => {
    const events = history({ inputTokens: 100, outputTokens: 5, cacheReadTokens: 50 });
    events.push({ seq: 1, time: 1, type: "session/compaction", data: { summary: "compacted" } });
    expect(sessionUsage(events)?.inputTokens).toBe(100);
    expect(sessionUsage(history({ inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 }, { inputTokens: 1, outputTokens: 1 }))).toMatchObject({ inputTokens: null, totalTokens: null, partial: true });
  });

  it("computes speed from real primary-call output and duration without helper calls replacing it", () => {
    const events: SessionEvent[] = [];
    const target = { appendEvent(type: string, data?: unknown) { const event = { seq: events.length, time: events.length, type, data }; events.push(event); return event; } };
    recordSessionUsage(target, { inputTokens: 1000, outputTokens: 426 }, "primary", { kind: "primary", durationMs: 2000 });
    recordSessionUsage(target, { inputTokens: 100, outputTokens: 100 }, "helper", { kind: "metadata", durationMs: 10 });
    recordSessionUsage(target, { inputTokens: 100, outputTokens: 100 }, "task", { kind: "task", durationMs: 10 });
    recordSessionUsage(target, { inputTokens: 100, outputTokens: 100 }, "summary", { kind: "compaction", durationMs: 10 });
    expect(sessionUsage(events)?.outputTokensPerSecond).toBe(213);
    expect(sessionUsage(events)?.calls).toBe(4);
    recordSessionUsage(target, { inputTokens: 20, outputTokens: 0 }, "primary", { kind: "primary", durationMs: 1000 });
    expect(sessionUsage(events)?.outputTokensPerSecond).toBe(0);
    recordSessionUsage(target, { inputTokens: 20, outputTokens: 10 }, "primary", { kind: "primary", durationMs: 0 });
    expect(sessionUsage(events)?.outputTokensPerSecond).toBeNull();
  });

  it("does not derive speed for legacy records or invalid durations", () => {
    expect(sessionUsage(history({ inputTokens: 100, outputTokens: 20 }))?.outputTokensPerSecond).toBeUndefined();
    const event: SessionEvent = { type: "model/usage", seq: 0, time: 0, data: { inputIncludesCache: true, kind: "primary", durationMs: Infinity, usage: { outputTokens: 20 } } };
    expect(sessionUsage([event])?.outputTokensPerSecond).toBeNull();
  });
});
