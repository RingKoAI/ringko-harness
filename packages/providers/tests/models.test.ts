import { describe, expect, it } from "bun:test";
import { CODEX_ORIGINATOR, codexUserAgent, codexVersion } from "@ringko-ai/auth";
import { codexModelsRequest, discoverModels } from "../src/models.ts";

describe("codexModelsRequest", () => {
  it("includes the required client version and Codex identity", () => {
    const request = codexModelsRequest("test-token", "test-account");
    const url = new URL(request.url);

    expect(url.pathname).toBe("/backend-api/codex/models");
    expect(url.searchParams.get("client_version")).toBe(codexVersion());
    expect(request.headers).toEqual({
      authorization: "Bearer test-token",
      originator: CODEX_ORIGINATOR,
      "user-agent": codexUserAgent(),
      "chatgpt-account-id": "test-account",
    });
  });

  it("omits the optional account header when no account id is stored", () => {
    const request = codexModelsRequest("test-token");
    expect(request.headers).not.toHaveProperty("chatgpt-account-id");
  });
});

describe("discoverModels", () => {
  it("returns live models and fails strictly when the endpoint is unavailable", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/v1/models") {
          return Response.json({ data: [{ id: "alpha" }, { id: "beta", display_name: "Beta" }] });
        }
        return new Response("missing", { status: 404 });
      },
    });
    try {
      const live = await discoverModels({ type: "openai-compatible", baseURL: `http://127.0.0.1:${server.port}/v1`, apiKey: "fixture" }, { strict: true });
      expect(live).toEqual([{ id: "alpha" }, { id: "beta", name: "Beta" }]);
      await expect(discoverModels({ type: "openai-compatible", baseURL: `http://127.0.0.1:${server.port}/missing` }, { strict: true })).rejects.toThrow();
      const fallback = await discoverModels({ type: "openai-compatible", baseURL: `http://127.0.0.1:${server.port}/missing` });
      expect(Array.isArray(fallback)).toBe(true);
    } finally {
      server.stop(true);
    }
  });
});
