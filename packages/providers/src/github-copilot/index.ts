// GitHub Copilot: reuse the Copilot API with a token-injecting fetch.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { applyProxyEnv, getOAuthAccount, updateOAuthCredential, type OAuthCredential } from "@ringko-ai/config";
import { refreshGitHubCopilot } from "@ringko-ai/auth";
import { copyHeaders } from "../fetch-util.ts";

export const COPILOT_AUTH_DOMAIN = "github-copilot";
export const COPILOT_BASE_URL = "https://api.githubcopilot.com";
export const GITHUB_API_VERSION = "2026-06-01";
/** Editor identity Copilot expects on every request (missing it is rejected). */
export const COPILOT_CLIENT_HEADERS: Record<string, string> = {
  "user-agent": "GitHubCopilotChat/0.35.0",
  "editor-version": "vscode/1.107.0",
  "editor-plugin-version": "copilot-chat/0.35.0",
  "copilot-integration-id": "vscode-chat",
};
const PLACEHOLDER_KEY = "ringko-oauth";
const REFRESH_SKEW_MS = 60_000;

export function createGitHubCopilotFetch(accountId?: string): typeof fetch {
  let pending: Promise<OAuthCredential> | null = null;
  const send = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    applyProxyEnv();
    const account = getOAuthAccount(COPILOT_AUTH_DOMAIN, accountId);
    if (!account) {
      throw new Error('Not signed in to GitHub Copilot. Run "ringko auth login github-copilot" first.');
    }
    let credential = account.credential;
    if (credential.expires <= Date.now() + REFRESH_SKEW_MS) {
      pending ??= refreshGitHubCopilot(credential.refresh)
        .then((next) => {
          // Keep display identity (login/avatar) from the existing credential.
          const merged: OAuthCredential = { ...credential, ...next };
          updateOAuthCredential(COPILOT_AUTH_DOMAIN, account.id, merged);
          return merged;
        })
        .finally(() => {
          pending = null;
        });
      credential = await pending;
    }
    const headers = copyHeaders(init?.headers);
    headers.set("authorization", `Bearer ${credential.access}`);
    for (const [name, value] of Object.entries(COPILOT_CLIENT_HEADERS)) {
      if (!headers.has(name)) headers.set(name, value);
    }
    headers.set("x-github-api-version", GITHUB_API_VERSION);
    headers.set("x-initiator", "user");
    headers.set("openai-intent", "conversation-edits");
    return fetch(input, { ...init, headers });
  };
  return send as unknown as typeof fetch;
}

/** Resolve a Copilot model (OpenAI-compatible chat completions). */
export function resolveGitHubCopilotModel(model: string, accountId?: string): LanguageModel {
  const provider = createOpenAICompatible({
    name: "github-copilot",
    baseURL: COPILOT_BASE_URL,
    apiKey: PLACEHOLDER_KEY,
    fetch: createGitHubCopilotFetch(accountId),
  });
  return provider.chatModel(model);
}
