import { describe, expect, it } from "bun:test";
import { CODEX_ORIGINATOR, codexUserAgent, codexVersion, extractResidency } from "../src/codex.ts";

function jwt(payload: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
}

describe("codex identity", () => {
  it("presents the Codex CLI originator and version", () => {
    expect(CODEX_ORIGINATOR).toBe("codex_cli_rs");
    expect(codexVersion({})).toBe("0.158.0");
    expect(codexVersion({ RINGKO_CODEX_VERSION: "1.2.3" })).toBe("1.2.3");
  });

  it("builds a User-Agent in the Codex CLI shape", () => {
    const ua = codexUserAgent({});
    expect(ua).toMatch(/^codex_cli_rs\/[^ ]+ \([^;)]+ [^;)]+; [^)]+\)$/);
    expect(ua.startsWith(`codex_cli_rs/${codexVersion({})} (`)).toBe(true);
  });

  it("reads compute residency, ignoring no_constraint", () => {
    expect(extractResidency(jwt({ chatgpt_compute_residency: "eu" }))).toBe("eu");
    expect(extractResidency(jwt({ "https://api.openai.com/auth": { chatgpt_compute_residency: "us" } }))).toBe("us");
    expect(extractResidency(jwt({ chatgpt_compute_residency: "no_constraint" }))).toBeUndefined();
    expect(extractResidency(undefined)).toBeUndefined();
  });
});
