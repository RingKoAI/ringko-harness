// xAI (Grok): OpenAI-compatible chat completions with a token-injecting fetch
// that adds the `X-XAI-Token-Auth` header the cli-chat-proxy expects.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { applyProxyEnv, getOAuthAccount, updateOAuthCredential, type OAuthCredential } from "@ringko-ai/config";
import { XAI_CLI_CHAT_PROXY_BASE_URL, refreshXai } from "@ringko-ai/auth";
import { copyHeaders } from "../fetch-util.ts";

/** Auth domain the xAI/Grok accounts live under. */
export const XAI_OAUTH_DOMAIN = "xai-oauth";
const XAI_TOKEN_AUTH_HEADER = "x-xai-token-auth";
const XAI_TOKEN_AUTH_VALUE = "xai-grok-cli";
const PLACEHOLDER_KEY = "ringko-oauth";
const REFRESH_SKEW_MS = 60_000;

/** A `fetch` that injects (and refreshes) the stored xAI bearer token. */
export function createXaiFetch(accountId?: string): typeof fetch {
  let pending: Promise<OAuthCredential> | null = null;
  const send = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    applyProxyEnv();
    const account = getOAuthAccount(XAI_OAUTH_DOMAIN, accountId);
    if (!account) {
      throw new Error('Not signed in to xAI. Run "ringko auth login xai-oauth" first.');
    }
    let credential = account.credential;
    if (credential.expires <= Date.now() + REFRESH_SKEW_MS) {
      pending ??= refreshXai(credential.refresh)
        .then((next) => {
          updateOAuthCredential(XAI_OAUTH_DOMAIN, account.id, next);
          return next;
        })
        .finally(() => {
          pending = null;
        });
      credential = await pending;
    }
    const headers = copyHeaders(init?.headers);
    headers.set("authorization", `Bearer ${credential.access}`);
    headers.set(XAI_TOKEN_AUTH_HEADER, XAI_TOKEN_AUTH_VALUE);
    return fetch(input, { ...init, headers });
  };
  return send as unknown as typeof fetch;
}

/** Resolve an xAI model backed by the Grok OAuth account (via cli-chat-proxy). */
export function resolveXaiOauthModel(model: string, accountId?: string): LanguageModel {
  const provider = createOpenAICompatible({
    name: "xai",
    baseURL: XAI_CLI_CHAT_PROXY_BASE_URL,
    apiKey: PLACEHOLDER_KEY,
    fetch: createXaiFetch(accountId),
  });
  return provider.chatModel(model);
}
