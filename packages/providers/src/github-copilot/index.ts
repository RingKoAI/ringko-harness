// GitHub Copilot: reuse the Copilot API with a token-injecting fetch.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { applyProxyEnv, getAuth } from "@ringko-ai/config";
import { copyHeaders } from "../fetch-util.ts";

export const COPILOT_PROVIDER_ID = "github-copilot";
const COPILOT_BASE_URL = "https://api.githubcopilot.com";
const GITHUB_API_VERSION = "2026-06-01";
const PLACEHOLDER_KEY = "ringko-oauth";

export function createGitHubCopilotFetch(providerId: string = COPILOT_PROVIDER_ID): typeof fetch {
  const send = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    applyProxyEnv();
    const auth = getAuth(providerId);
    if (!auth || auth.type !== "oauth") {
      throw new Error('Not signed in to GitHub Copilot. Run "ringko auth login github-copilot" first.');
    }
    const headers = copyHeaders(init?.headers);
    headers.set("authorization", `Bearer ${auth.access}`);
    headers.set("x-github-api-version", GITHUB_API_VERSION);
    headers.set("x-initiator", "user");
    headers.set("openai-intent", "conversation-edits");
    return fetch(input, { ...init, headers });
  };
  return send as unknown as typeof fetch;
}

/** Resolve a Copilot model (OpenAI-compatible chat completions). */
export function resolveGitHubCopilotModel(model: string, providerId: string = COPILOT_PROVIDER_ID): LanguageModel {
  const provider = createOpenAICompatible({
    name: "github-copilot",
    baseURL: COPILOT_BASE_URL,
    apiKey: PLACEHOLDER_KEY,
    fetch: createGitHubCopilotFetch(providerId),
  });
  return provider.chatModel(model);
}
