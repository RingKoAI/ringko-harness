import { getOAuthAccount } from "@ringko-ai/config";
import { XAI_CLI_CHAT_PROXY_BASE_URL } from "@ringko-ai/auth";
import { XAI_OAUTH_DOMAIN, resolveXaiOauthModel } from "./xai/index.ts";
import { fetchModels } from "./discovery.ts";
import type { ProviderAdapter } from "./types.ts";

export default {
  aliases: ["xai", "grok"],
  resolveModel: options => resolveXaiOauthModel(options.model),
  async discoverModels(_input, options) {
    const account = getOAuthAccount(XAI_OAUTH_DOMAIN);
    if (!account) return undefined;
    return fetchModels(`${XAI_CLI_CHAT_PROXY_BASE_URL}/models`, { authorization: `Bearer ${account.credential.access}`, "x-xai-token-auth": "xai-grok-cli" }, options.bounded, options.signal);
  },
} satisfies ProviderAdapter;
