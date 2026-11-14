import type { ProviderPreset } from "./types.ts";
export default { id: "mistral", label: "Mistral", type: "openai-compatible", baseURL: "https://api.mistral.ai/v1", apiKeyEnv: "MISTRAL_API_KEY", auth: "apikey" } satisfies ProviderPreset;
