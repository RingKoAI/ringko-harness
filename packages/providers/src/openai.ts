import { createOpenAI, openai } from "@ai-sdk/openai";
import { fetchModels } from "./discovery.ts";
import type { ProviderAdapter } from "./types.ts";

export default {
  resolveModel(options) {
    if (!options.apiKey && !options.baseURL) return openai(options.model);
    return createOpenAI({ ...(options.apiKey ? { apiKey: options.apiKey } : {}), ...(options.baseURL ? { baseURL: options.baseURL } : {}), ...(options.headers ? { headers: options.headers } : {}) })(options.model);
  },
  discoverModels(input, options) {
    const base = (input.baseURL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    return fetchModels(`${base}/models`, input.apiKey ? { authorization: `Bearer ${input.apiKey}` } : {}, options.bounded, options.signal);
  },
} satisfies ProviderAdapter;
