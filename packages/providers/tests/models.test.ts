import { describe, expect, it } from "bun:test";
import { CODEX_ORIGINATOR, codexUserAgent, codexVersion } from "@ringko-ai/auth";
import { codexModelsRequest } from "../src/models.ts";

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
