import { describe, expect, it } from "bun:test";
import {
  Agent,
  ToolRegistry,
  defineTool,
  type ModelClient,
  type ModelToolCall,
  type ToolConcurrency,
} from "../src/index.ts";

const log: string[] = [];

function makeTool(name: string, concurrency?: ToolConcurrency, delayMs = 10) {
  return defineTool({
    name,
    description: name,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    ...(concurrency ? { concurrency } : {}),
    parseInput: () => ({}),
    assessRisk: () => ({ kind: "safe" as const, reason: name }),
    async execute() {
      log.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      log.push(`${name}:end`);
      return name;
    },
  });
}

describe("tool scheduling", () => {
  it("overlaps parallel calls and fences exclusive ones", async () => {
    log.length = 0;
    const tools = new ToolRegistry();
    tools.register(makeTool("a"));
    tools.register(makeTool("b"));
    tools.register(makeTool("c", "exclusive", 5));
    tools.register(makeTool("d"));

    let calls = 0;
    const model: ModelClient = async () => {
      calls += 1;
      if (calls > 1) return { content: "done", toolCalls: [] };
      const batch: ModelToolCall[] = [
        { id: "1", name: "a", arguments: {} },
        { id: "2", name: "b", arguments: {} },
        { id: "3", name: "c", arguments: {} },
        { id: "4", name: "d", arguments: {} },
      ];
      return { content: "", toolCalls: batch };
    };

    const agent = new Agent({ model, tools, maxParallelTools: 10 });
    await agent.run("go");

    // a and b overlap (b starts before a ends).
    expect(log.indexOf("b:start")).toBeLessThan(log.indexOf("a:end"));
    // the exclusive c waits for both a and b, then runs alone.
    expect(log.indexOf("c:start")).toBeGreaterThan(log.indexOf("a:end"));
    expect(log.indexOf("c:start")).toBeGreaterThan(log.indexOf("b:end"));
    // d runs after the exclusive barrier.
    expect(log.indexOf("d:start")).toBeGreaterThan(log.indexOf("c:end"));
  });
});
