import { getOAuthAccount } from "@ringko-ai/config";
import { CODEX_ORIGINATOR, OPENAI_CODEX_ENDPOINT, codexUserAgent, codexVersion } from "@ringko-ai/auth";
import { OPENAI_OAUTH_DOMAIN, resolveOpenAiOauthModel } from "./openai/index.ts";
import { fetchModels } from "./discovery.ts";
import type { ProviderAdapter } from "./types.ts";

export function codexModelsRequest(access: string, accountId?: string): { url: string; headers: Record<string, string> } {
  const url = new URL(`${OPENAI_CODEX_ENDPOINT}/models`);
  url.searchParams.set("client_version", codexVersion());
  return { url: url.toString(), headers: { authorization: `Bearer ${access}`, originator: CODEX_ORIGINATOR, "user-agent": codexUserAgent(), ...(accountId ? { "chatgpt-account-id": accountId } : {}) } };
}

export default {
  aliases: ["oauth", "chatgpt"],
  forceStream: true,
  resolveModel: options => resolveOpenAiOauthModel(options.model, options.accountId),
  async discoverModels(_input, options) {
    const account = getOAuthAccount(OPENAI_OAUTH_DOMAIN);
    if (!account) return undefined;
    const request = codexModelsRequest(account.credential.access, account.credential.accountId);
    const models = await fetchModels(request.url, request.headers, options.bounded, options.signal);
    return models.length ? models : undefined;
  },
} satisfies ProviderAdapter;
