import { getOAuthAccount } from "@ringko-ai/config";
import { COPILOT_AUTH_DOMAIN, COPILOT_CLIENT_HEADERS, GITHUB_API_VERSION, resolveGitHubCopilotModel } from "./github-copilot/index.ts";
import { fetchModels } from "./discovery.ts";
import type { ProviderAdapter } from "./types.ts";

export const COPILOT_MODELS_URL = "https://api.githubcopilot.com/models";
export default {
  aliases: ["copilot"],
  resolveModel: options => resolveGitHubCopilotModel(options.model),
  async discoverModels(_input, options) {
    const account = getOAuthAccount(COPILOT_AUTH_DOMAIN);
    if (!account) return undefined;
    return fetchModels(COPILOT_MODELS_URL, { authorization: `Bearer ${account.credential.access}`, "x-github-api-version": GITHUB_API_VERSION, ...COPILOT_CLIENT_HEADERS }, options.bounded, options.signal);
  },
} satisfies ProviderAdapter;
