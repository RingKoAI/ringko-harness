// Anthropic via Claude Pro/Max OAuth: inject the stored bearer token and the
// `anthropic-beta: oauth-2025-04-20` header the subscription endpoint expects.
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { applyProxyEnv, getOAuthAccount, updateOAuthCredential, type OAuthCredential } from "@ringko-ai/config";
import { refreshAnthropic } from "@ringko-ai/auth";
import { copyHeaders } from "../fetch-util.ts";

/** Auth domain the Anthropic subscription accounts live under. */
export const ANTHROPIC_OAUTH_DOMAIN = "anthropic-oauth";
const PLACEHOLDER_KEY = "ringko-oauth";
const REFRESH_SKEW_MS = 60_000;
/** Beta features Claude Code sends with subscription tokens. */
const OAUTH_BETAS = ["claude-code-20250219", "oauth-2025-04-20"];
const CLAUDE_CLI_USER_AGENT = `claude-cli/${process.env.RINGKO_CLAUDE_VERSION ?? "2.0.0"}`;

function mergeBetas(headers: Headers): void {
  const existing = headers.get("anthropic-beta");
  const betas = new Set((existing ?? "").split(",").map((part) => part.trim()).filter((part) => part.length > 0));
  for (const beta of OAUTH_BETAS) betas.add(beta);
  headers.set("anthropic-beta", [...betas].join(","));
}

/** A `fetch` that injects (and refreshes) the stored Anthropic OAuth bearer. */
export function createAnthropicOauthFetch(accountId?: string): typeof fetch {
  let pending: Promise<OAuthCredential> | null = null;
  const send = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    applyProxyEnv();
    const account = getOAuthAccount(ANTHROPIC_OAUTH_DOMAIN, accountId);
    if (!account) {
      throw new Error('Not signed in to Anthropic. Run "ringko auth login anthropic-oauth" first.');
    }
    let credential = account.credential;
    if (credential.expires <= Date.now() + REFRESH_SKEW_MS) {
      pending ??= refreshAnthropic(credential.refresh)
        .then((next) => {
          updateOAuthCredential(ANTHROPIC_OAUTH_DOMAIN, account.id, next);
          return next;
        })
        .finally(() => {
          pending = null;
        });
      credential = await pending;
    }
    const headers = copyHeaders(init?.headers);
    headers.delete("x-api-key");
    headers.set("authorization", `Bearer ${credential.access}`);
    if (!headers.has("user-agent")) headers.set("user-agent", CLAUDE_CLI_USER_AGENT);
    mergeBetas(headers);
    return fetch(input, { ...init, headers });
  };
  return send as unknown as typeof fetch;
}

/** Resolve an Anthropic model backed by the Claude subscription OAuth account. */
export function resolveAnthropicOauthModel(model: string, accountId?: string): LanguageModel {
  const client = createAnthropic({
    apiKey: PLACEHOLDER_KEY,
    fetch: createAnthropicOauthFetch(accountId),
  });
  return client(model);
}
