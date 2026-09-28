import { describe, expect, it } from "bun:test";
import { EventBus } from "../src/index.ts";

type Events = {
  "mode/route": { instructions: string };
  "session/event": { type: string };
  ping: { count: number };
};

describe("EventBus", () => {
  it("serial runs listeners in order", async () => {
    const bus = new EventBus<Events>();
    const order: string[] = [];
    bus.on("session/event", async () => {
      await Bun.sleep(5);
      order.push("a");
    });
    bus.on("session/event", () => {
      order.push("b");
    });
    await bus.serial("session/event", { type: "x" });
    expect(order).toEqual(["a", "b"]);
  });

  it("parallel awaits all listeners", async () => {
    const bus = new EventBus<Events>();
    const seen: number[] = [];
    bus.on("ping", async () => {
      await Bun.sleep(5);
      seen.push(1);
    });
    bus.on("ping", () => {
      seen.push(2);
    });
    await bus.parallel("ping", { count: 0 });
    expect(seen.sort()).toEqual([1, 2]);
  });

  it("on returns a disposer", async () => {
    const bus = new EventBus<Events>();
    let calls = 0;
    const off = bus.on("ping", () => {
      calls += 1;
    });
    await bus.parallel("ping", { count: 0 });
    off();
    await bus.parallel("ping", { count: 0 });
    expect(calls).toBe(1);
    expect(bus.count("ping")).toBe(0);
  });

  it("waterfall chains and lets listeners mutate the event", async () => {
    const bus = new EventBus<Events>();
    bus.onWaterfall("mode/route", (event, next) => next({ instructions: `${event.instructions}+a` }));
    bus.onWaterfall("mode/route", (event, next) => next({ instructions: `${event.instructions}+b` }));
    const result = await bus.waterfall("mode/route", { instructions: "base" });
    expect(result.instructions).toBe("base+a+b");
  });

  it("waterfall short-circuits when next is not called", async () => {
    const bus = new EventBus<Events>();
    const reached: string[] = [];
    bus.onWaterfall("mode/route", (event) => ({ instructions: `${event.instructions}+stop` }));
    bus.onWaterfall("mode/route", (event, next) => {
      reached.push("second");
      return next(event);
    });
    const result = await bus.waterfall("mode/route", { instructions: "base" });
    expect(result.instructions).toBe("base+stop");
    expect(reached).toEqual([]);
  });
});
