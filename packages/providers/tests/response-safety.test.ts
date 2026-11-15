import { expect, it } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { createAiSdkModelClient, TOOL_STREAM_LIMITS } from "../src/ai-sdk.ts";

const usage = { inputTokens: { total: 1, noCache: undefined, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: undefined, reasoning: undefined } };
const tools = [{ name: "echo", description: "Echo text", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }];

function completedModel(inputs: string[], stream: boolean, ids = inputs.map((_, index) => `call-${index}`)) {
  const content = inputs.map((input, index) => ({ type: "tool-call" as const, toolCallId: ids[index], toolName: "echo", input }));
  return createAiSdkModelClient(new MockLanguageModelV4({
    doGenerate: async () => ({ content, usage, warnings: [], finishReason: { unified: "tool-calls", raw: undefined } }),
    doStream: async () => ({ stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: "stream-start", warnings: [] });
      for (const part of content) controller.enqueue(part);
      controller.enqueue({ type: "finish", usage, finishReason: { unified: "tool-calls", raw: undefined } }); controller.close();
    } }) }),
  }), { stream });
}

const request = { messages: [{ role: "user" as const, content: "fixture" }], tools };

it("keeps credentials echoed by provider messages, bodies and URLs out of public HTTP errors", async () => {
  const secret = "fixture-provider-secret-DO_NOT_EXPOSE";
  for (const stream of [false, true]) {
    const failure = () => Object.assign(new Error(`Upstream echoed ${secret}`), { statusCode: 401, responseBody: JSON.stringify({ error: { message: secret, code: "invalid_api_key", param: secret, type: secret } }), url: `https://user:${secret}@fixture.invalid/v1?api_key=${secret}` });
    const model = new MockLanguageModelV4({ doGenerate: async () => { throw failure(); }, doStream: async () => { throw failure(); } });
    try { await createAiSdkModelClient(model, { stream })({ messages: [{ role: "user", content: "fixture" }], tools: [] }); throw new Error("Expected failure"); }
    catch (error) {
      expect(String(error)).not.toContain(secret);
      expect(String(error)).toContain("401");
    }
  }
});

it("does not echo arbitrary provider stream errors", async () => {
  const secret = "fixture-stream-secret-DO_NOT_EXPOSE";
  const model = new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({ start(controller) {
    controller.enqueue({ type: "stream-start", warnings: [] }); controller.enqueue({ type: "error", error: new Error(secret) }); controller.close();
  } }) }) });
  await expect(createAiSdkModelClient(model, { stream: true })({ messages: [{ role: "user", content: "fixture" }], tools: [] })).rejects.not.toThrow(secret);
});

it("enforces the tool-count budget even when the provider sends only completed calls", async () => {
  for (const stream of [false, true]) {
    const inputs = Array<string>(TOOL_STREAM_LIMITS.calls).fill('{"text":"fixture"}');
    expect((await completedModel(inputs, stream)(request)).toolCalls).toHaveLength(TOOL_STREAM_LIMITS.calls);
    await expect(completedModel([...inputs, inputs[0]], stream)(request)).rejects.toThrow("tool call");
  }
});

it("enforces the argument budget on complete calls that bypass argument delta events", async () => {
  const overhead = JSON.stringify({ text: "" }).length;
  for (const stream of [false, true]) {
    const input = JSON.stringify({ text: "x".repeat(TOOL_STREAM_LIMITS.argumentCharacters - overhead) });
    expect((await completedModel([input], stream)(request)).toolCalls).toHaveLength(1);
    await expect(completedModel([JSON.stringify({ text: "x".repeat(TOOL_STREAM_LIMITS.argumentCharacters - overhead + 1) })], stream)(request)).rejects.toThrow("size limit");
    const inputs = Array<string>(TOOL_STREAM_LIMITS.totalCharacters / TOOL_STREAM_LIMITS.argumentCharacters).fill(input);
    expect((await completedModel(inputs, stream)(request)).toolCalls).toHaveLength(inputs.length);
    await expect(completedModel([...inputs, '{"text":""}'], stream)(request)).rejects.toThrow("aggregate size limit");
  }
});

it("rejects duplicate completed tool identities in streaming and non-streaming responses", async () => {
  for (const stream of [false, true]) await expect(completedModel(['{"text":"first"}', '{"text":"second"}'], stream, ["duplicate", "duplicate"])(request)).rejects.toThrow("tool call");
});

it("uses fixed public messages for timeout and cancellation errors", async () => {
  for (const name of ["TimeoutError", "AbortError"]) {
    const model = new MockLanguageModelV4({ doGenerate: async () => { throw new DOMException("fixture-private-provider-detail", name); } });
    await expect(createAiSdkModelClient(model)(request)).rejects.not.toThrow("fixture-private-provider-detail");
  }
});
