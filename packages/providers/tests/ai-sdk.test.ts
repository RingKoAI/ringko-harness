import { describe, expect, it } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import type { ChatMessage, ToolMetadata } from "@ringko-ai/harness";
import { createAiSdkModelClient, toModelMessages } from "../src/ai-sdk.ts";

const usage = {
  inputTokens: { total: 1, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: undefined, reasoning: undefined },
};

const echoMetadata: ToolMetadata[] = [
  {
    name: "echo",
    description: "Echo the given text.",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  },
];

describe("AI SDK model client", () => {
  it("retries a rejected stream token limit before delivering any output", async () => {
    let attempts = 0;
    const model = new MockLanguageModelV4({ doStream: async options => {
      attempts++;
      if (options.maxOutputTokens !== undefined) throw Object.assign(new Error("invalid_parameter"), { statusCode: 400 });
      return { stream: new ReadableStream({ start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "text-start", id: "t" });
        controller.enqueue({ type: "text-delta", id: "t", delta: "recovered" });
        controller.enqueue({ type: "text-end", id: "t" });
        controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: undefined }, usage });
        controller.close();
      } }) };
    } });
    const chunks: string[] = [];
    const turn = await createAiSdkModelClient(model, { maxOutputTokens: 100 })({ messages: [{ role: "user", content: "hi" }], tools: [], onDelta: delta => chunks.push(delta.text) });
    expect(attempts).toBe(2);
    expect(chunks).toEqual(["recovered"]);
    expect(turn.content).toBe("recovered");
  });
  it("delivers reasoning and text chunks before returning one completed turn", async () => {
    const model = new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: "stream-start", warnings: [] });
      controller.enqueue({ type: "reasoning-start", id: "r" });
      controller.enqueue({ type: "reasoning-delta", id: "r", delta: "thinking" });
      controller.enqueue({ type: "reasoning-end", id: "r" });
      controller.enqueue({ type: "text-start", id: "t" });
      controller.enqueue({ type: "text-delta", id: "t", delta: "hello " });
      controller.enqueue({ type: "text-delta", id: "t", delta: "world" });
      controller.enqueue({ type: "text-end", id: "t" });
      controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: undefined }, usage });
      controller.close();
    } }) }) });
    const chunks: string[] = [];
    const turn = await createAiSdkModelClient(model)({ messages: [{ role: "user", content: "hi" }], tools: [], onDelta: delta => chunks.push(`${delta.kind}:${delta.text}`) });
    expect(chunks).toEqual(["reasoning:thinking", "text:hello ", "text:world"]);
    expect(turn).toMatchObject({ content: "hello world", reasoning: "thinking" });
  });
  it("passes child instructions and background notifications through SDK instructions", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async options => {
      const text = JSON.stringify(options.prompt);
      expect(text).toContain("host instructions");
      expect(text).toContain("child instructions");
      expect(text).toContain("background result");
      return { content: [{ type: "text", text: "reviewed" }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
    } });
    const result = await createAiSdkModelClient(model, { system: "host instructions" })({ messages: [{ role: "system", content: "child instructions" }, { role: "user", content: "Inspect" }, { role: "system", content: "background result" }], tools: [] });
    expect(result.content).toBe("reviewed");
  });
  it("returns text content", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: "hello" }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      }),
    });

    const turn = await createAiSdkModelClient(model)({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
    });

    expect(turn).toMatchObject({ content: "hello", toolCalls: [] });
  });

  it("surfaces model tool calls with their arguments", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "tool-call", toolCallId: "call-1", toolName: "echo", input: '{"text":"ping"}' }],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage,
        warnings: [],
      }),
    });

    const turn = await createAiSdkModelClient(model)({
      messages: [{ role: "user", content: "go" }],
      tools: echoMetadata,
    });

    expect(turn.content).toBe("");
    expect(turn.toolCalls).toEqual([{ id: "call-1", name: "echo", arguments: { text: "ping" } }]);
  });
});

describe("toModelMessages", () => {
  it("rebuilds assistant tool calls and tool results", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "be brief" },
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call-1", name: "echo", arguments: { text: "ping" } }],
      },
      { role: "tool", content: "pong", toolCallId: "call-1", name: "echo" },
    ];

    expect(toModelMessages(messages)).toEqual([
      { role: "system", content: "be brief" },
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "call-1", toolName: "echo", input: { text: "ping" } }],
      },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "call-1", toolName: "echo", output: { type: "text", value: "pong" } },
        ],
      },
    ]);
  });

  it("replays assistant reasoning blocks ahead of text", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        content: "answer",
        reasoningDetails: [{ text: "thinking", providerOptions: { anthropic: { signature: "sig" } } }],
      },
    ];

    expect(toModelMessages(messages)).toEqual([
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "thinking", providerOptions: { anthropic: { signature: "sig" } } },
          { type: "text", text: "answer" },
        ],
      },
    ]);
  });
});
