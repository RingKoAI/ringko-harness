import { describe, expect, it } from "bun:test";
import { Agent, AgentTurnLimitError, MAX_STEERING_QUEUE, type AgentEvent, type ChatMessage, type ModelClient } from "../src/agent.ts";
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
  it("does not execute streamed tool previews before a validated complete turn and approval", async () => {
    let executed = 0, asked = 0, requests = 0;
    const ready = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const tools = new ToolRegistry(); tools.register({ ...echoTool("shell"), execute: ({ text }) => { executed++; return text; } });
    const model: ModelClient = async request => {
      if (++requests > 1) return { content: "done", toolCalls: [] };
      request.onToolInput?.({ kind: "start", id: "a", name: "echo" });
      request.onToolInput?.({ kind: "delta", id: "a", text: '{"text":' });
      ready.resolve(); await release.promise;
      return { content: "", toolCalls: [{ id: "a", name: "echo", arguments: { text: "hello" } }] };
    };
    const previews: string[] = [];
    const run = new Agent({ model, tools, onToolInput: event => previews.push(event.kind), requestApproval: async () => { asked++; return false; } }).run("go");
    await ready.promise; expect(previews).toEqual(["start", "delta"]); expect(executed).toBe(0); expect(asked).toBe(0);
    release.resolve(); await run; expect(asked).toBe(1); expect(executed).toBe(0);
  });
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

it("carries structured tool parts into the next model request and event", async () => {
  let seen: readonly ChatMessage[] | undefined;
  const model: ModelClient = async (request) => {
    if (request.messages.some((message) => message.role === "tool")) {
      seen = request.messages;
      return { content: "done", toolCalls: [] };
    }
    return { content: "", toolCalls: [{ id: "c1", name: "capture", arguments: {} }] };
  };
  const tools = new ToolRegistry();
  tools.register({
    name: "capture",
    description: "Capture a fixture image.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    parseInput: () => ({}),
    assessRisk: () => ({ kind: "safe", reason: "fixture" }),
    execute: () => ({ ok: true }),
    toMessage: () => ({
      content: "captured",
      parts: [
        { type: "text", text: "captured" },
        { type: "image", mediaType: "image/png", data: "aGVsbG8=" },
      ],
    }),
  });
  const events: AgentEvent[] = [];
  await new Agent({ model, tools, onEvent: (event) => events.push(event) }).run("go");

  const toolMessage = seen?.find((message) => message.role === "tool");
  expect(toolMessage).toMatchObject({
    content: "captured",
    parts: [
      { type: "text", text: "captured" },
      { type: "image", mediaType: "image/png", data: "aGVsbG8=" },
    ],
  });
  expect(events.find((event) => event.type === "tool")?.message.parts).toHaveLength(2);
});

it("records a renderer failure as a tool error without losing the run", async () => {
  let seen: readonly ChatMessage[] | undefined;
  const model: ModelClient = async (request) => {
    if (request.messages.some((message) => message.role === "tool")) {
      seen = request.messages;
      return { content: "done", toolCalls: [] };
    }
    return { content: "", toolCalls: [{ id: "c1", name: "capture", arguments: {} }] };
  };
  const tools = new ToolRegistry();
  tools.register({
    name: "capture",
    description: "Capture a malformed fixture.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    parseInput: () => ({}),
    assessRisk: () => ({ kind: "safe", reason: "fixture" }),
    execute: () => ({ ok: true }),
    toMessage: () => ({ content: "x", parts: [{ type: "image", mediaType: "image/png", data: "not base64!" }] }),
  });
  const events: AgentEvent[] = [];
  const result = await new Agent({ model, tools, onEvent: (event) => events.push(event) }).run("go");

  expect(result.content).toBe("done");
  expect(seen?.find((message) => message.role === "tool")?.content).toContain("invalid image data");
  expect(events.find((event) => event.type === "tool_error")?.toolName).toBe("capture");
});

describe("Agent steering", () => {
  it("injects steered user messages after tool results and preserves correlation ids", async () => {
    const seenRequests: ChatMessage[][] = [];
    const events: AgentEvent[] = [];
    const tools = new ToolRegistry();
    let agentRef: Agent | undefined;
    tools.register({
      name: "step",
      description: "Steer mid-tool.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      parseInput: () => ({}),
      assessRisk: () => ({ kind: "safe", reason: "fixture" }),
      execute: () => {
        agentRef?.steer({ id: "steer-1", content: "Include BANANA" });
        return "tool-done";
      },
    });
    const model: ModelClient = async (request) => {
      seenRequests.push([...request.messages]);
      if (seenRequests.length === 1) {
        return { content: "Running step", toolCalls: [{ id: "c1", name: "step", arguments: {} }] };
      }
      return { content: "Final BANANA", toolCalls: [] };
    };
    const agent = new Agent({ model, tools, onEvent: (event) => events.push(event) });
    agentRef = agent;
    const result = await agent.run("Start work");

    expect(result.content).toBe("Final BANANA");
    expect(result.turns).toBe(2);
    expect(seenRequests[1]?.map((m) => [m.role, m.content])).toEqual([
      ["user", "Start work"],
      ["assistant", "Running step"],
      ["tool", "tool-done"],
      ["user", "Include BANANA"],
    ]);
    expect(events.find((e) => e.type === "user")).toMatchObject({
      type: "user",
      turn: 1,
      inputId: "steer-1",
      message: { role: "user", content: "Include BANANA" },
    });
  });

  it("keeps the run open when steering arrives during a final no-tool model turn", async () => {
    const events: AgentEvent[] = [];
    const tools = new ToolRegistry();
    const externalSteers: Array<{ id: string; content: string }> = [];
    let calls = 0;
    const model: ModelClient = async () => {
      calls += 1;
      if (calls === 1) {
        externalSteers.push({ id: "late-steer", content: "One more thing" });
        return { content: "Initial final answer", toolCalls: [] };
      }
      return { content: "Addressed one more thing", toolCalls: [] };
    };
    const agent = new Agent({
      model,
      tools,
      drainSteering: () => externalSteers.splice(0),
      onEvent: (event) => events.push(event),
    });
    const result = await agent.run("Hello");

    expect(calls).toBe(2);
    expect(result.content).toBe("Addressed one more thing");
    expect(result.messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "Hello"],
      ["assistant", "Initial final answer"],
      ["user", "One more thing"],
      ["assistant", "Addressed one more thing"],
    ]);
    expect(events.map((e) => e.type)).toEqual(["model", "user", "model"]);
  });

  it("validates steered prompts, enforces queue capacity, and does not drain after abort", async () => {
    const controller = new AbortController();
    const externalSteers = ["keep-unclaimed"];
    const tools = new ToolRegistry();
    const agent = new Agent({
      model: async () => {
        controller.abort();
        return { content: "aborted", toolCalls: [] };
      },
      tools,
      signal: controller.signal,
      drainSteering: () => externalSteers.splice(0),
    });

    expect(() => agent.steer("   ")).toThrow(TypeError);
    for (let i = 0; i < MAX_STEERING_QUEUE; i += 1) agent.steer(`msg ${i}`);
    expect(() => agent.steer("overflow")).toThrow("full");

    await expect(agent.run("start")).rejects.toThrow();
    expect(externalSteers).toEqual(["keep-unclaimed"]);
  });
});
