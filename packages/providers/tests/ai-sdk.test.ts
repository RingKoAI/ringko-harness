import { describe, expect, it } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import type { ChatMessage, ModelToolInputDelta, ToolMetadata } from "@ringko-ai/harness";
import { createAiSdkModelClient, reasoningReplayFor, toModelMessages, toolFailureMessage, TOOL_STREAM_LIMITS } from "../src/ai-sdk.ts";

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
  it("rejects malformed final tool JSON rather than treating it as executable input", async () => {
    for (const stream of [false, true]) {
      const model = new MockLanguageModelV4({
        doGenerate: async () => ({ content: [{ type: "tool-call", toolCallId: "bad", toolName: "echo", input: '{"text":' }], finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [] }),
        doStream: async () => ({ stream: new ReadableStream({ start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "tool-call", toolCallId: "bad", toolName: "echo", input: '{"text":' });
          controller.enqueue({ type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage }); controller.close();
        } }) }),
      });
      await expect(createAiSdkModelClient(model, { stream })({ messages: [{ role: "user", content: "go" }], tools: echoMetadata })).rejects.toThrow("invalid tool arguments");
    }
  });

  it("rejects oversized streamed arguments and duplicate starts", async () => {
    for (const duplicate of [false, true]) {
      const model = new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({ start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "tool-input-start", id: "a", toolName: "echo" });
        if (duplicate) controller.enqueue({ type: "tool-input-start", id: "a", toolName: "echo" });
        else controller.enqueue({ type: "tool-input-delta", id: "a", delta: 'x'.repeat(TOOL_STREAM_LIMITS.argumentCharacters + 1) });
        controller.close();
      } }) }) });
      await expect(createAiSdkModelClient(model, { stream: true })({ messages: [{ role: "user", content: "go" }], tools: echoMetadata })).rejects.toThrow(duplicate ? "Invalid or excessive" : "size limit");
    }
  });
  it("classifies provider tool failures without echoing their text", () => {
    expect(toolFailureMessage("AI_InvalidToolInputError: JSON parsing failed: Text: {\"secret\":1}")).toContain("invalid tool arguments");
    expect(toolFailureMessage(new Error("NoSuchToolError: no such tool 'shell'"))).toContain("not registered");
    expect(toolFailureMessage("provider blew up with api-key=sk-live-123")).toBe("The provider reported a tool failure before the harness could execute the call.");
    expect(toolFailureMessage("provider blew up")).not.toContain("sk-live");
  });

  it("streams interleaved tool arguments before the completed turn without executing them", async () => {
    const ready = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const events: ModelToolInputDelta[] = [];
    const model = new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({ async start(controller) {
      controller.enqueue({ type: "stream-start", warnings: [] });
      for (const id of ["a", "b"]) controller.enqueue({ type: "tool-input-start", id, toolName: "echo" });
      controller.enqueue({ type: "tool-input-delta", id: "a", delta: '{"text":"你' });
      controller.enqueue({ type: "tool-input-delta", id: "b", delta: '{"text":"second"}' });
      await release.promise;
      controller.enqueue({ type: "tool-input-delta", id: "a", delta: '好"}' });
      for (const [id, text] of [["a", "你好"], ["b", "second"]]) {
        controller.enqueue({ type: "tool-input-end", id });
        controller.enqueue({ type: "tool-call", toolCallId: id, toolName: "echo", input: JSON.stringify({ text }) });
      }
      controller.enqueue({ type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage }); controller.close();
    } }) }) });
    let finished = false;
    const pending = createAiSdkModelClient(model)({ messages: [{ role: "user", content: "go" }], tools: echoMetadata, onToolInput: event => { events.push(event); if (events.length === 4) ready.resolve(); } }).then(turn => { finished = true; return turn; });
    await ready.promise; expect(finished).toBe(false); expect(events[2]).toEqual({ kind: "delta", id: "a", text: '{"text":"你' });
    release.resolve(); const turn = await pending;
    expect(turn.toolCalls).toEqual([{ id: "a", name: "echo", arguments: { text: "你好" } }, { id: "b", name: "echo", arguments: { text: "second" } }]);
    expect(events.filter(event => event.kind === "end")).toHaveLength(2);
  });

  it("does not retry after streamed tool input and rejects incomplete tool calls", async () => {
    for (const fail of [true, false]) {
      let attempts = 0;
      const model = new MockLanguageModelV4({ doStream: async () => {
        attempts++;
        return { stream: new ReadableStream({ start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "tool-input-start", id: "a", toolName: "echo" });
          controller.enqueue({ type: "tool-input-delta", id: "a", delta: '{"text":' });
          if (fail) controller.enqueue({ type: "error", error: Object.assign(new Error("invalid_parameter"), { statusCode: 400 }) });
          else controller.enqueue({ type: "finish", finishReason: { unified: "length", raw: undefined }, usage });
          controller.close();
        } }) };
      } });
      await expect(createAiSdkModelClient(model, { maxOutputTokens: 100, stream: true })({ messages: [{ role: "user", content: "go" }], tools: echoMetadata })).rejects.toThrow();
      expect(attempts).toBe(1);
    }
  });

  it("cancels a tool argument stream without returning executable calls", async () => {
    const controller = new AbortController();
    const model = new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({ start(stream) {
      stream.enqueue({ type: "stream-start", warnings: [] }); stream.enqueue({ type: "tool-input-start", id: "a", toolName: "echo" });
      stream.enqueue({ type: "tool-input-delta", id: "a", delta: '{"text":"partial' });
    } }) }) });
    await expect(createAiSdkModelClient(model)({ messages: [{ role: "user", content: "go" }], tools: echoMetadata, signal: controller.signal, onToolInput: () => controller.abort() })).rejects.toThrow();
  });
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

  it("maps structured image parts onto AI SDK content blocks", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: "look",
        parts: [
          { type: "text", text: "look" },
          { type: "image", mediaType: "image/png", data: "aGVsbG8=" },
        ],
      },
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "read", arguments: { path: "a.png" } }] },
      {
        role: "tool",
        content: "Image a.png",
        toolCallId: "c1",
        name: "read",
        parts: [
          { type: "text", text: "Image a.png" },
          { type: "image", mediaType: "image/png", data: "aGVsbG8=" },
        ],
      },
    ];
    const out = toModelMessages(messages);
    expect(out[0]).toMatchObject({
      role: "user",
      content: [
        { type: "text", text: "look" },
        { type: "file", mediaType: "image/png", data: { type: "data", data: "aGVsbG8=" } },
      ],
    });
    expect(out[2]).toMatchObject({
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId: "c1",
        output: {
          type: "content",
          value: [
            { type: "text", text: "Image a.png" },
            { type: "file", mediaType: "image/png", data: { type: "data", data: "aGVsbG8=" } },
          ],
        },
      }],
    });
  });

  it("replays only reasoning the active provider accepts", () => {
    const messages: ChatMessage[] = [{
      role: "assistant",
      content: "answer",
      reasoning: "fallback",
      reasoningDetails: [
        { text: "plain" },
        { text: "signed", providerOptions: { anthropic: { signature: "sig" } } },
        { text: "google", providerOptions: { google: { thoughtSignature: "gs" } } },
        { text: "openai", providerOptions: { openai: { itemId: "i" } } },
      ],
    }];
    expect(toModelMessages(messages, { reasoningReplay: "anthropic" })[0]).toMatchObject({ role: "assistant", content: [
      { type: "reasoning", text: "signed", providerOptions: { anthropic: { signature: "sig" } } },
      { type: "text", text: "answer" },
    ] });
    expect(toModelMessages(messages, { reasoningReplay: "google" })[0]).toMatchObject({ content: [
      { type: "reasoning", text: "google", providerOptions: { google: { thoughtSignature: "gs" } } },
      { type: "text", text: "answer" },
    ] });
    expect(toModelMessages(messages, { reasoningReplay: "openai" })[0]).toMatchObject({ content: [
      { type: "reasoning", text: "openai", providerOptions: { openai: { itemId: "i" } } },
      { type: "text", text: "answer" },
    ] });
    expect(toModelMessages(messages, { reasoningReplay: "text" })[0]).toMatchObject({ content: [
      { type: "reasoning", text: "plain" },
      { type: "text", text: "answer" },
    ] });
  });

  it("falls back to reasoning text only for text providers", () => {
    const messages: ChatMessage[] = [{ role: "assistant", content: "answer", reasoning: "plain" }];
    expect(toModelMessages(messages, { reasoningReplay: "text" })[0]).toMatchObject({ content: [
      { type: "reasoning", text: "plain" },
      { type: "text", text: "answer" },
    ] });
    expect(toModelMessages(messages, { reasoningReplay: "anthropic" })[0]).toMatchObject({ content: [
      { type: "text", text: "answer" },
    ] });
  });

  it("drops foreign reasoning instead of relabelling it", () => {
    const messages: ChatMessage[] = [{
      role: "assistant",
      content: "answer",
      reasoning: "fallback",
      reasoningDetails: [{ text: "signed", providerOptions: { anthropic: { signature: "sig" } } }],
    }];
    expect(toModelMessages(messages, { reasoningReplay: "text" })[0]).toMatchObject({ content: [
      { type: "text", text: "answer" },
    ] });
  });

  it("maps thinking levels to each provider's own request field", async () => {
    const seen: unknown[] = [];
    const model = () => new MockLanguageModelV4({
      doGenerate: async (input: { providerOptions?: unknown }) => {
        seen.push(input.providerOptions);
        return { content: [{ type: "text", text: "ok" }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
      },
    });
    const call = async (options: Parameters<typeof createAiSdkModelClient>[1]) => {
      await createAiSdkModelClient(model(), options)({ messages: [{ role: "user", content: "hi" }], tools: [] });
    };
    await call({ provider: "anthropic", model: "claude-opus-5-5", thinking: "high" });
    await call({ provider: "anthropic", model: "claude-3-5-sonnet", thinking: "low", maxOutputTokens: 8_000 });
    await call({ provider: "google", model: "gemini-2.5-pro", thinking: "high" });
    await call({ provider: "openai-compatible", name: "futureppo-codex", thinking: "max" });
    await call({ provider: "openai", thinking: "off" });
    expect(seen).toEqual([
      { anthropic: { cacheControl: { type: "ephemeral" }, thinking: { type: "adaptive", display: "summarized" }, effort: "high" } },
      { anthropic: { cacheControl: { type: "ephemeral" }, thinking: { type: "enabled", budgetTokens: 4_000 } } },
      { google: { thinkingConfig: { thinkingBudget: 16_000, includeThoughts: true } } },
      { "futureppo-codex": { reasoningEffort: "max" } },
      { openai: { reasoningEffort: "none" } },
    ]);
  });

  it("maps provider kinds to reasoning replay rules", () => {
    expect(reasoningReplayFor("anthropic")).toBe("anthropic");
    expect(reasoningReplayFor("anthropic-oauth")).toBe("anthropic");
    expect(reasoningReplayFor("google")).toBe("google");
    expect(reasoningReplayFor("openai-oauth")).toBe("openai");
    expect(reasoningReplayFor("openai-compatible")).toBe("text");
    expect(reasoningReplayFor("xai-oauth")).toBe("text");
  });
});
