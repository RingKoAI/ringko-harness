import { resolveAnthropicOauthModel } from "./anthropic/index.ts";
import type { ProviderAdapter } from "./types.ts";

export default {
  aliases: ["claude-oauth"],
  resolveModel: options => resolveAnthropicOauthModel(options.model),
} satisfies ProviderAdapter;
