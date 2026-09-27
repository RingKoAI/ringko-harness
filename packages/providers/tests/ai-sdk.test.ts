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

    expect(turn).toEqual({ content: "hello", toolCalls: [] });
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
});
