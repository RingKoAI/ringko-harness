import type { ProviderPreset } from "./types.ts";
export default { id: "openrouter", label: "OpenRouter", type: "openai-compatible", baseURL: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY", auth: "apikey" } satisfies ProviderPreset;
