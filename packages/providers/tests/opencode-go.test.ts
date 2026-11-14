import { expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { createProviderClient } from "../src/index.ts";
import { discoverModels } from "../src/models.ts";
import { resolveProviderConfig } from "../src/loader.ts";

it("uses the compatibility API for Go model families and stable transport-only session headers", async () => {
  const seen: Array<{ headers: Headers; body: Record<string, unknown>; path: string }> = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json() as Record<string, unknown>; seen.push({ headers: request.headers, body, path: new URL(request.url).pathname });
    return Response.json({ id: "fixture", object: "chat.completion", created: 0, model: body.model, choices: [{ index: 0, message: { role: "assistant", content: "connected" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } });
  } });
  try {
    for (const model of ["deepseek-v4-pro", "claude-haiku-5-5", "gemini-4-argon", "gpt-6-luna"]) {
      const client = createProviderClient({ provider: "opencode-go", model, baseURL: `http://127.0.0.1:${server.port}/openai/v1`, apiKey: "fixture-key", thinking: "high" });
      for (const sessionId of ["session-one", "session-one", "session-two"]) expect((await client({ messages: [{ role: "user", content: "hello" }], tools: [], sessionId })).content).toBe("connected");
    }
    expect(seen).toHaveLength(12);
    for (const request of seen) {
      expect(request.path).toBe("/openai/v1/chat/completions"); expect(request.headers.get("authorization")).toBe("Bearer fixture-key");
      expect(request.headers.get("user-agent")).toContain("ringko-harness"); expect(JSON.stringify(request.body)).not.toContain("session-one");
      expect(request.body.reasoning_effort).toBe("high");
    }
    expect(seen[0]!.headers.get("x-opencode-session")).toBe(createHash("sha256").update("session-one").digest("hex"));
    expect(seen[0]!.headers.get("x-opencode-session")).toBe(seen[1]!.headers.get("x-opencode-session"));
    expect(seen[1]!.headers.get("x-opencode-session")).not.toBe(seen[2]!.headers.get("x-opencode-session"));
    expect(resolveProviderConfig({ provider: { name: "go", type: "opencodego", apiKey: "fixture" }, model: { id: "model", name: "Model" } }).provider).toBe("opencode-go");
  } finally { server.stop(true); }
});

it("requires credentials without exposing invalid key material", () => {
  const previous = process.env.OPENCODE_API_KEY; delete process.env.OPENCODE_API_KEY;
  try {
    expect(() => createProviderClient({ provider: "opencode-go", model: "model" })).toThrow("requires an API key");
    expect(() => createProviderClient({ provider: "opencode-go", model: "model", apiKey: "private\nkey" })).toThrow("invalid characters");
  } finally { if (previous === undefined) delete process.env.OPENCODE_API_KEY; else process.env.OPENCODE_API_KEY = previous; }
});

it("discovers the public Go directory without credentials and bounds malformed responses", async () => {
  let oversized = false;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    expect(new URL(request.url).pathname).toBe("/v1/models"); expect(request.headers.get("authorization")).toBeNull();
    return oversized ? new Response(" ".repeat(2 * 1024 * 1024 + 1)) : Response.json({ data: [{ id: "gemini-4-argon", name: "Gemini 4 Argon" }, { id: "bad\u0000id" }] });
  } });
  try {
    const input = { type: "opencode-go", baseURL: `http://127.0.0.1:${server.port}/openai/v1`, apiKey: "must-not-leak" };
    expect(await discoverModels(input, { strict: true })).toEqual([{ id: "gemini-4-argon", name: "Gemini 4 Argon" }]);
    oversized = true; await expect(discoverModels(input, { strict: true })).rejects.toThrow("size limit");
    const aborted = AbortSignal.abort(); await expect(discoverModels(input, { strict: true, signal: aborted })).rejects.toThrow();
  } finally { server.stop(true); }
});

it("retains identity headers across token-limit retries, streaming and sessionless calls", async () => {
  const seen: Headers[] = []; let rejected = false;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json() as Record<string, unknown>; seen.push(request.headers);
    if (!rejected) { rejected = true; return Response.json({ error: { message: "invalid_parameter", code: "invalid_parameter" } }, { status: 400 }); }
    if (body.stream) return new Response(`data: ${JSON.stringify({ id: "stream", model: body.model, choices: [{ index: 0, delta: { role: "assistant", content: "streamed" }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "stream", model: body.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    return Response.json({ id: "fixture", object: "chat.completion", created: 0, model: body.model, choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  } });
  try {
    const client = createProviderClient({ provider: "opencode-go", model: "model", apiKey: "fixture", baseURL: `http://127.0.0.1:${server.port}/v1`, maxOutputTokens: 128 });
    expect((await client({ messages: [{ role: "user", content: "retry" }], tools: [] })).content).toBe("ok");
    const chunks: string[] = []; expect((await client({ messages: [{ role: "user", content: "stream" }], tools: [], onDelta: delta => chunks.push(delta.text) })).content).toBe("streamed"); expect(chunks.join("")).toBe("streamed");
    expect(seen).toHaveLength(3); expect(new Set(seen.map(headers => headers.get("x-opencode-session"))).size).toBe(1);
    for (const headers of seen) expect(headers.get("user-agent")).toContain("ringko-harness");
  } finally { server.stop(true); }
});

it("does not expose provider error bodies that echo private credentials", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ error: { message: "private-fixture-key" } }, { status: 401 }) });
  try {
    const client = createProviderClient({ provider: "opencode-go", model: "model", apiKey: "private-fixture-key", baseURL: `http://127.0.0.1:${server.port}/v1` });
    try { await client({ messages: [{ role: "user", content: "hello" }], tools: [] }); throw new Error("Expected a provider failure"); }
    catch (error) { expect(String(error)).toContain("HTTP 401"); expect(String(error)).not.toContain("private-fixture-key"); }
  } finally { server.stop(true); }
});
