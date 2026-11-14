import { createGoogleGenerativeAI, google } from "@ai-sdk/google";
import type { ProviderAdapter } from "./types.ts";

export default {
  aliases: ["gemini", "google-generative-ai"],
  resolveModel(options) {
    if (!options.apiKey && !options.baseURL) return google(options.model);
    return createGoogleGenerativeAI({ ...(options.apiKey ? { apiKey: options.apiKey } : {}), ...(options.baseURL ? { baseURL: options.baseURL } : {}), ...(options.headers ? { headers: options.headers } : {}) })(options.model);
  },
} satisfies ProviderAdapter;
