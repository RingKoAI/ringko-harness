import type { ProviderPreset } from "./types.ts";
export default { id: "xai-api", label: "xAI (API key)", type: "openai-compatible", baseURL: "https://api.x.ai/v1", apiKeyEnv: "XAI_API_KEY", auth: "apikey" } satisfies ProviderPreset;
