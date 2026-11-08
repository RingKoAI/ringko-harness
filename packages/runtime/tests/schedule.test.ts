import { describe, expect, it, spyOn } from "bun:test";
import { ToolRegistry } from "@ringko-ai/harness";
import { EventLog, Scheduler, createScheduleTool, nextOccurrence } from "../src/index.ts";

describe("nextOccurrence", () => {
  it("at returns the time when in the future", () => {
    expect(nextOccurrence({ kind: "at", at: 5000 }, 1000)).toBe(5000);
    expect(nextOccurrence({ kind: "at", at: 500 }, 1000)).toBeUndefined();
  });

  it("every adds the interval", () => {
    expect(nextOccurrence({ kind: "every", everyMs: 1000 }, 1000)).toBe(2000);
  });

  it("daily picks the next HH:MM", () => {
    const from = new Date(2026, 0, 1, 8, 0, 0).getTime();
    const next = nextOccurrence({ kind: "daily", hour: 9, minute: 30 }, from);
    expect(next).toBeDefined();
    const date = new Date(next!);
    expect(date.getHours()).toBe(9);
    expect(date.getMinutes()).toBe(30);
    expect(next!).toBeGreaterThan(from);
  });

  it("weekly picks the weekday", () => {
    const monday = new Date(2026, 0, 5, 10, 0, 0).getTime();
    expect(new Date(monday).getDay()).toBe(1);
    const next = nextOccurrence({ kind: "weekly", weekday: 3, hour: 12, minute: 0 }, monday);
    expect(new Date(next!).getDay()).toBe(3);
  });

  it("cron computes the next matching minute", () => {
    const from = new Date(2026, 0, 5, 10, 2, 0).getTime();
    const next = nextOccurrence({ kind: "cron", cron: "*/15 * * * *" }, from);
    expect(next).toBeDefined();
    expect(new Date(next!).getMinutes() % 15).toBe(0);
  });
});

describe("Scheduler", () => {
  it("chunks long waits without firing early or shifting a recurring deadline", () => {
    let now = 1_000;
    const callbacks: (() => void)[] = [], delays: number[] = [];
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    const timers = spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay: number) => {
      callbacks.push(callback); delays.push(delay); return { unref() {} };
    }) as unknown as typeof setTimeout);
    const clear = spyOn(globalThis, "clearTimeout").mockImplementation(() => {});
    try {
      const interval = 30 * 24 * 60 * 60 * 1000;
      for (const rule of [{ kind: "at", at: now + interval }, { kind: "every", everyMs: interval }] as const) {
        const log = new EventLog(), scheduler = new Scheduler(log);
        const task = scheduler.create(rule), due = task.next!;
        expect(delays.at(-1)).toBe(2_147_483_647);
        now += 2_147_483_647; callbacks.shift()!();
        expect(log.all()).toHaveLength(0); expect(task.next).toBe(due);
        expect(delays.at(-1)).toBe(due - now);
        now = due; callbacks.shift()!();
        expect(log.all()).toHaveLength(1);
        if (rule.kind === "every") { expect(task.next).toBe(due + interval); scheduler.remove(task.id); callbacks.length = 0; }
        else expect(scheduler.list()).toHaveLength(0);
      }
    } finally { clock.mockRestore(); timers.mockRestore(); clear.mockRestore(); }
  });
  it("rejects a one-shot time in the past without leaving a dead task", () => {
    const scheduler = new Scheduler(new EventLog());
    expect(() => scheduler.create({ kind: "at", at: Date.now() - 1_000 })).toThrow("must be in the future");
    expect(scheduler.list()).toEqual([]);
  });

  it("fires an every schedule into the log", async () => {
    const log = new EventLog();
    const scheduler = new Scheduler(log);
    scheduler.create({ kind: "every", everyMs: 150 }, { data: { note: "hi" } });
    await Bun.sleep(250);
    const result = await log.subscribe({ topics: ["time"] });
    expect(result.events.length).toBeGreaterThan(0);
    expect((result.events[0]?.data as { scheduled?: boolean }).scheduled).toBe(true);
  });
});

describe("schedule tool", () => {
  it("creates, lists, and removes", async () => {
    const log = new EventLog();
    const registry = new ToolRegistry();
    registry.register(createScheduleTool(new Scheduler(log)));
    const created = (await registry.call("schedule", { action: "create", daily: "09:00" })) as { created?: { id: string } };
    expect(created.created?.id).toBeDefined();
    const list = (await registry.call("schedule", { action: "list" })) as { tasks: unknown[] };
    expect(list.tasks).toHaveLength(1);
    const removed = (await registry.call("schedule", { action: "remove", id: created.created!.id })) as { tasks: unknown[] };
    expect(removed.tasks).toHaveLength(0);
  });
});
