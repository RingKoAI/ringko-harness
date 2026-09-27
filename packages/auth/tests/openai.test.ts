import { describe, expect, it } from "bun:test";
import { buildAuthorizeUrl, extractAccountId, generatePkce } from "../src/openai.ts";

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
});
