import { describe, expect, it } from "bun:test";
import { trajectoryPage, TRAJECTORY_DETAILS_LIMIT } from "../src/trajectory.ts";
import type { SessionEvent } from "../src/types.ts";

function event(seq: number, type: string, data: unknown, time = seq * 10): SessionEvent {
  return { seq, type, data, time };
}

describe("trajectory projection", () => {
  it("pages backward and forward by stable sequence rather than mutable offsets", () => {
    const events = Array.from({ length: 6 }, (_, seq) => event(seq, "user/message", { content: `message ${seq}` }));
    expect(trajectoryPage(events, { limit: 2 })).toMatchObject({ records: [{ seq: 4 }, { seq: 5 }], hasOlder: true, hasNewer: false });
    expect(trajectoryPage(events, { before: 4, limit: 2 }).records.map(item => item.seq)).toEqual([2, 3]);
    expect(trajectoryPage(events, { after: 1, limit: 2 })).toMatchObject({ records: [{ seq: 2 }, { seq: 3 }], hasNewer: true });
    expect(trajectoryPage(events, { after: 5 }).records).toEqual([]);
    expect(trajectoryPage([])).toEqual({ records: [], hasOlder: false, hasNewer: false, lastSeq: -1 });
  });

  it("derives tool duration across pages and does not invent missing or negative timing", () => {
    const events = [
      event(0, "tool/call", { toolCallId: "a", name: "read" }, 10),
      event(1, "tool/result", { toolCallId: "a", name: "read", failed: true, content: "error" }, 25),
      event(2, "tool/result", { toolCallId: "orphan", content: "output" }, 30),
      event(3, "tool/call", { toolCallId: "b" }, 50),
      event(4, "tool/result", { toolCallId: "b" }, 40),
    ];
    const page = trajectoryPage(events, { after: 0 });
    expect(page.records[0]).toMatchObject({ failed: true, durationMs: 15, kind: "tool" });
    expect(page.records.slice(1).map(item => item.durationMs)).toEqual([null, null, null]);
  });

  it("bounds displayed event data while retaining unknown event types", () => {
    const source = event(0, "custom/event", { content: "x".repeat(TRAJECTORY_DETAILS_LIMIT) });
    const result = trajectoryPage([source]).records[0];
    expect(result.kind).toBe("session");
    expect(result.truncated).toBe(true);
    expect(result.details.length).toBe(TRAJECTORY_DETAILS_LIMIT);
    expect((source.data as { content: string }).content.length).toBe(TRAJECTORY_DETAILS_LIMIT);
  });

  it("rejects invalid or ambiguous cursor requests", () => {
    for (const options of [{ before: 1, after: 2 }, { before: -1 }, { limit: 51 }, { limit: NaN }, { after: 1.5 }]) {
      expect(() => trajectoryPage([], options)).toThrow("Invalid trajectory page");
    }
  });
});
