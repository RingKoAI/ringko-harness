import { expect, it } from "bun:test";
import { oauthFailureMessage, safeOAuthErrorCode } from "../src/errors.ts";
import { refreshOpenAi } from "../src/openai.ts";
import { refreshXai } from "../src/xai.ts";
import { refreshAnthropic } from "../src/anthropic.ts";
import { refreshGitHubCopilot } from "../src/copilot.ts";

it("keeps provider response bodies and tokens out of OAuth failures", async () => {
  const secret = "fixture-refresh-secret-DO_NOT_EXPOSE";
  const original = globalThis.fetch;
  try {
    globalThis.fetch = Object.assign(
      async () => new Response(
        JSON.stringify({ error: "invalid_grant", error_description: secret }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
      { preconnect: original.preconnect },
    ) as typeof fetch;
    for (const refresh of [refreshOpenAi, refreshXai, refreshAnthropic, refreshGitHubCopilot]) {
      const error = await refresh(secret).then(() => undefined, (failure: unknown) => failure);
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain(secret);
      expect(String(error)).toContain("400");
      expect(String(error)).toContain("invalid_grant");
    }
  } finally {
    globalThis.fetch = original;
  }
});

it("only forwards bounded protocol error codes", () => {
  expect(oauthFailureMessage("Token", 400, JSON.stringify({ error: "invalid_grant" }))).toContain("(invalid_grant)");
  expect(oauthFailureMessage("Token", 400, JSON.stringify({ error: "bad code; secret" }))).not.toContain("bad code");
  expect(oauthFailureMessage("Token", 400, "<html>secret</html>")).not.toContain("secret");
  expect(safeOAuthErrorCode("x".repeat(300))).toBeUndefined();
});
