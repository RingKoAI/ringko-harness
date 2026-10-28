import { describe, expect, it } from "bun:test";
import { Agent, AgentTurnLimitError, type ModelClient } from "../src/agent.ts";
import { ToolRegistry, type ToolDefinition } from "../src/tools.ts";

function echoTool(kind: "safe" | "shell"): ToolDefinition<{ text: string }, string> {
  return {
    name: "echo",
    description: "Return the given text.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
    parseInput(value) {
      if (
        typeof value !== "object" ||
        value === null ||
        !("text" in value) ||
        typeof value.text !== "string"
      ) {
        throw new TypeError("Expected text.");
      }
      return { text: value.text };
    },
    assessRisk: () => ({ kind, reason: "Test tool." }),
    execute: ({ text }) => text,
  };
}

describe("agent harness", () => {
  it("returns a final model response without calling tools", async () => {
    const model: ModelClient = async (request) => {
      expect(request.messages.at(-1)?.content).toBe("hello");
      expect(request.tools).toHaveLength(1);
      return { content: "hi", toolCalls: [] };
    };
    const tools = new ToolRegistry();
    tools.register(echoTool("safe"));

    const result = await new Agent({ model, tools }).run("hello");

    expect(result.content).toBe("hi");
    expect(result.turns).toBe(1);
  });

  it("feeds a tool result back to the model and then finishes", async () => {
    let calls = 0;
    const model: ModelClient = async (request) => {
      calls += 1;
      if (calls === 1) {
        return {
          content: "",
          toolCalls: [{ id: "call-1", name: "echo", arguments: { text: "pong" } }],
        };
      }
      expect(request.messages.at(-1)).toMatchObject({
        role: "tool",
        content: "pong",
        toolCallId: "call-1",
      });
      return { content: "done", toolCalls: [] };
    };
    const tools = new ToolRegistry();
    tools.register(echoTool("safe"));

    const result = await new Agent({ model, tools }).run("ping");

    expect(result.content).toBe("done");
    expect(result.turns).toBe(2);
  });

  it("returns a tool failure to the model instead of executing past the gate", async () => {
    let asked = false;
    const model: ModelClient = async (request) => {
      if (request.messages.filter((message) => message.role === "tool").length === 0) {
        return {
          content: "",
          toolCalls: [{ id: "call-1", name: "echo", arguments: { text: "rm" } }],
        };
      }
      return { content: request.messages.at(-1)?.content ?? "", toolCalls: [] };
    };
    const tools = new ToolRegistry();
    tools.register(echoTool("shell"));

    const result = await new Agent({
      model,
      tools,
      requestApproval: async (request) => {
        asked = true;
        expect(request.toolName).toBe("echo");
        return false;
      },
    }).run("do it");

    expect(asked).toBe(true);
    expect(result.content).toContain("Approval was not granted");
  });

  it("stops when the model never finishes", async () => {
    const model: ModelClient = async () => ({ content: "", toolCalls: [] });
    const looping: ModelClient = async () => ({
      content: "",
      toolCalls: [{ id: "call-1", name: "echo", arguments: { text: "again" } }],
    });
    const tools = new ToolRegistry();
    tools.register(echoTool("safe"));

    await expect(new Agent({ model: looping, tools, maxTurns: 2 }).run("loop")).rejects.toBeInstanceOf(
      AgentTurnLimitError,
    );
    await expect(new Agent({ model, tools }).run("   ")).rejects.toThrow("must not be empty");
  });

  it("rejects duplicate tool call ids before any tool executes", async () => {
    let executed = false;
    const tools = new ToolRegistry();
    tools.register({ ...echoTool("safe"), execute: () => { executed = true; return "ok"; } });
    const model: ModelClient = async () => ({
      content: "",
      toolCalls: [
        { id: "same", name: "echo", arguments: { text: "a" } },
        { id: "same", name: "echo", arguments: { text: "b" } },
      ],
    });
    await expect(new Agent({ model, tools }).run("go")).rejects.toThrow("invalid tool call");
    expect(executed).toBe(false);
  });

  it("does not enter a tool when its pre-execution event fails", async () => {
    let executed = false;
    const tools = new ToolRegistry();
    tools.register({ ...echoTool("safe"), execute: () => { executed = true; return "ok"; } });
    const model: ModelClient = async () => ({
      content: "",
      toolCalls: [{ id: "c1", name: "echo", arguments: { text: "x" } }],
    });
    await expect(new Agent({
      model,
      tools,
      onEvent(event) {
        if (event.type === "tool_call") throw new Error("checkpoint failed");
      },
    }).run("go")).rejects.toThrow("checkpoint failed");
    expect(executed).toBe(false);
  });
});

function namedTool(name: string, execute: () => unknown): ToolDefinition<Record<string, unknown>, unknown> {
  return {
    name,
    description: "Controlled probe.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    parseInput: value => value as Record<string, unknown>,
    assessRisk: () => ({ kind: "safe", reason: "probe" }),
    execute,
  };
}

it("commits completed tool results and marks unstarted calls when cancelled", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve });
  let slowStarted!: () => void;
  const slowBegan = new Promise<void>(resolve => { slowStarted = resolve });
  const tools = new ToolRegistry();
  tools.register(namedTool("fast", () => "fast done"));
  tools.register(namedTool("slow", async () => { slowStarted(); await gate; return "slow done"; }));
  const events: { type: string; toolName?: string; message?: { content?: string } }[] = [];
  const controller = new AbortController();
  const agent = new Agent({
    tools,
    signal: controller.signal,
    maxParallelTools: 1,
    onEvent: event => events.push(event),
    model: async () => ({ content: "", toolCalls: [
      { id: "a", name: "fast", arguments: {} },
      { id: "b", name: "slow", arguments: {} },
      { id: "c", name: "fast", arguments: {} },
    ] }),
  });
  const run = agent.run("probe").catch(error => error);
  await slowBegan;
  controller.abort(new Error("cancelled"));
  release();
  const outcome = await run;
  expect(outcome).toBeInstanceOf(Error);
  const toolEvents = events.filter(event => event.type === "tool" || event.type === "tool_error");
  expect(toolEvents).toHaveLength(3);
  expect(toolEvents[0]).toMatchObject({ type: "tool", toolName: "fast", message: { content: "fast done" } });
  expect(toolEvents[1]).toMatchObject({ type: "tool", toolName: "slow", message: { content: "slow done" } });
  expect(toolEvents[2]).toMatchObject({ type: "tool_error", toolName: "fast" });
  expect(toolEvents[2]?.message?.content).toContain("not started");
});
