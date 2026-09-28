import { describe, expect, it } from "bun:test";
import { ToolRegistry } from "@ringko-ai/harness";
import { EventLog, createSubscribeTool, createTimeSource, parseDuration } from "../src/index.ts";

describe("EventLog", () => {
  it("assigns monotonic seq and reads after a cursor", async () => {
    const log = new EventLog();
    log.append("time", { tick: 1 });
    log.append("time", { tick: 2 });
    const first = await log.subscribe({ topics: ["time"], after: -1 });
    expect(first.events.map((event) => event.seq)).toEqual([0, 1]);
    expect(first.lastSeq).toBe(1);
    const next = await log.subscribe({ topics: ["time"], after: 1 });
    expect(next.events).toEqual([]);
  });

  it("long-polls until an event arrives", async () => {
    const log = new EventLog();
    const pending = log.subscribe({ topics: ["x"], after: -1, waitMs: 1000 });
    setTimeout(() => log.append("x", { ok: true }), 10);
    const result = await pending;
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.data).toEqual({ ok: true });
  });

  it("filters by topic", async () => {
    const log = new EventLog();
    log.append("a", 1);
    log.append("b", 2);
    const result = await log.subscribe({ topics: ["b"], after: -1 });
    expect(result.events.map((event) => event.topic)).toEqual(["b"]);
  });
});

describe("subscribe tool", () => {
  it("exposes events through the harness registry", async () => {
    const log = new EventLog();
    log.append("time", { tick: 1 });
    const registry = new ToolRegistry();
    registry.register(createSubscribeTool(log));
    const output = (await registry.call("subscribe", { topics: ["time"], after: -1 })) as { events: unknown[] };
    expect(output.events).toHaveLength(1);
  });
});

describe("time source", () => {
  it("emits ticks", async () => {
    const log = new EventLog();
    const stop = createTimeSource(log, { intervalMs: 5 });
    await Bun.sleep(20);
    stop();
    expect(log.all().length).toBeGreaterThan(0);
    expect(log.all()[0]?.topic).toBe("time");
  });
});

describe("interval subscribe", () => {
  it("parses durations", () => {
    expect(parseDuration("10s")).toBe(10_000);
    expect(parseDuration("5m")).toBe(300_000);
    expect(parseDuration(250)).toBe(250);
    expect(parseDuration("bad")).toBeUndefined();
    expect(parseDuration(10)).toBeUndefined();
  });

  it("returns the next tick for an every subscription", async () => {
    const log = new EventLog();
    const registry = new ToolRegistry();
    registry.register(createSubscribeTool(log));
    const started = Date.now();
    const output = (await registry.call("subscribe", { topics: ["time"], every: "200ms" })) as {
      events: { topic: string; data: { intervalMs: number } }[];
    };
    expect(output.events.length).toBeGreaterThan(0);
    expect(output.events[0]?.topic).toBe("time");
    expect(output.events[0]?.data.intervalMs).toBe(200);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
