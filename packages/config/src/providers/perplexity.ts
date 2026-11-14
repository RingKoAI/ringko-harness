import type { ProviderPreset } from "./types.ts";
export default { id: "perplexity", label: "Perplexity", type: "openai-compatible", baseURL: "https://api.perplexity.ai", apiKeyEnv: "PERPLEXITY_API_KEY", auth: "apikey" } satisfies ProviderPreset;
