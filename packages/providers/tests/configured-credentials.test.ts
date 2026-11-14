import { expect, it } from "bun:test";
import { createProviderClient } from "../src/index.ts";

it("uses configured Anthropic and Google credentials, endpoints and headers from CLI setup", async () => {
  const visited: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname; visited.push(path); expect(request.headers.get("x-fixture")).toBe("configured");
    if (path === "/anthropic/v1/messages") {
      expect(request.headers.get("x-api-key")).toBe("configured-anthropic-key");
      return Response.json({ id: "fixture", type: "message", role: "assistant", model: "claude-fixture", content: [{ type: "text", text: "native configured" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
    }
    expect(path).toBe("/google/v1beta/models/gemini-fixture:generateContent"); expect(request.headers.get("x-goog-api-key")).toBe("configured-google-key");
    return Response.json({ candidates: [{ content: { role: "model", parts: [{ text: "native configured" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } });
  } });
  try {
    const url = `http://127.0.0.1:${server.port}`;
    for (const options of [{ provider: "anthropic", model: "claude-fixture", apiKey: "configured-anthropic-key", baseURL: `${url}/anthropic/v1` }, { provider: "google", model: "gemini-fixture", apiKey: "configured-google-key", baseURL: `${url}/google/v1beta` }]) {
      const client = createProviderClient({ ...options, maxOutputTokens: 128, headers: { "x-fixture": "configured" } });
      expect((await client({ messages: [{ role: "user", content: "hello" }], tools: [] })).content).toBe("native configured");
    }
    expect(visited).toHaveLength(2);
  } finally { server.stop(true); }
});
