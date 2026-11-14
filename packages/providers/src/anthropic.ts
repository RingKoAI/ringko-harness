import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import type { ProviderAdapter } from "./types.ts";

export default {
  resolveModel(options) {
    if (!options.apiKey && !options.baseURL && !options.headers) return anthropic(options.model);
    return createAnthropic({ ...(options.apiKey ? { apiKey: options.apiKey } : {}), ...(options.baseURL ? { baseURL: options.baseURL } : {}), ...(options.headers ? { headers: options.headers } : {}) })(options.model);
  },
} satisfies ProviderAdapter;
