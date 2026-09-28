import { describe, expect, it } from "bun:test";
import { buildAuthorizeUrl, extractAccountId, generatePkce, loginOpenAiBrowser } from "../src/openai.ts";
import { renderOAuthCallbackPage } from "../src/callback-page.ts";

function jwt(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${body}.sig`;
}

describe("openai oauth", () => {
  it("generates a PKCE verifier and S256 challenge", () => {
    const { verifier, challenge } = generatePkce();
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(challenge).not.toContain("=");
  });

  it("builds the authorize URL", () => {
    const url = new URL(buildAuthorizeUrl("challenge", "state123"));
    expect(url.origin).toBe("https://auth.openai.com");
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("app_EMoamEEZ73f0CkXaXp7hrann");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("state123");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:1455/auth/callback");
    expect(url.searchParams.get("originator")).toBe("codex_cli_rs");
    expect(url.searchParams.get("scope")).toContain("offline_access");
  });

  it("extracts the account id from claims", () => {
    expect(extractAccountId(jwt({ chatgpt_account_id: "acc-1" }))).toBe("acc-1");
    expect(extractAccountId(undefined, jwt({ organizations: [{ id: "org-9" }] }))).toBe("org-9");
    expect(extractAccountId(jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acc-2" } }))).toBe("acc-2");
    expect(extractAccountId("not-a-jwt")).toBeUndefined();
  });

  it("shows a browser error page and rejects promptly when authorization is denied", async () => {
    let resolveResponse!: (value: { status: number; body: string }) => void;
    let rejectResponse!: (error: Error) => void;
    const response = new Promise<{ status: number; body: string }>((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });
    const login = loginOpenAiBrowser((authorizeUrl) => {
      const state = new URL(authorizeUrl).searchParams.get("state");
      void fetch(`http://localhost:1455/auth/callback?state=${encodeURIComponent(state ?? "")}&error=access_denied`)
        .then(async (result) => resolveResponse({ status: result.status, body: await result.text() }))
        .catch(rejectResponse);
    });
    const outcome = login.then(() => "resolved", (error: unknown) => error);

    const page = await response;
    expect(page.status).toBe(400);
    expect(page.body).toContain("Sign-in failed");
    expect(page.body).toContain("Authorization was cancelled or denied.");
    expect(page.body).not.toContain("access_denied");
    expect((await outcome as Error).message).toContain("denied or cancelled");
  });

  it("provides specific, static error pages without embedding provider input", () => {
    expect(renderOAuthCallbackPage("OpenAI", { status: "error", reason: "invalid-state" })).toContain("could not be verified");
    expect(renderOAuthCallbackPage("OpenAI", { status: "error", reason: "missing-code" })).toContain("did not include a code");
    expect(renderOAuthCallbackPage("OpenAI", { status: "error", reason: "token-exchange" })).toContain("could not complete the token exchange");
    expect(renderOAuthCallbackPage("OpenAI", { status: "error", reason: "timed-out" })).toContain("took too long");
  });

  it("uses the same page for other providers and escapes provider names", () => {
    const page = renderOAuthCallbackPage('<Provider & "team">', { status: "success" });
    expect(page).toContain('&lt;Provider &amp; &quot;team&quot;&gt; is connected to RingKo.');
    expect(page).not.toContain('<Provider & "team">');
  });
});
