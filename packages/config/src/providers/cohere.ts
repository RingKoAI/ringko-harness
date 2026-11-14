import type { ProviderPreset } from "./types.ts";
export default { id: "cohere", label: "Cohere", type: "openai-compatible", baseURL: "https://api.cohere.ai/compatibility/v1", apiKeyEnv: "COHERE_API_KEY", auth: "apikey" } satisfies ProviderPreset;
