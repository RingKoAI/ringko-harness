import type { ProviderPreset } from "./types.ts";
export default { id: "sambanova", label: "SambaNova", type: "openai-compatible", baseURL: "https://api.sambanova.ai/v1", apiKeyEnv: "SAMBANOVA_API_KEY", auth: "apikey" } satisfies ProviderPreset;
