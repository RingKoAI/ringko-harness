import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { fetchModels } from "./discovery.ts";
import type { ProviderAdapter } from "./types.ts";

export default {
  aliases: ["openaicompatible", "compatible", "customendpoint"],
  resolveModel(options) {
    if (!options.baseURL) throw new TypeError('Provider "openai-compatible" requires a baseURL.');
    return createOpenAICompatible({ name: options.name ?? "openai-compatible", baseURL: options.baseURL, ...(options.apiKey ? { apiKey: options.apiKey } : {}), ...(options.headers ? { headers: options.headers } : {}) }).chatModel(options.model);
  },
  async discoverModels(input, options) {
    if (!input.baseURL) return undefined;
    return fetchModels(`${input.baseURL.replace(/\/+$/, "")}/models`, input.apiKey ? { authorization: `Bearer ${input.apiKey}` } : {}, options.bounded, options.signal);
  },
} satisfies ProviderAdapter;
