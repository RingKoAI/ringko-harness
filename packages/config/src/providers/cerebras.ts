import type { ProviderPreset } from "./types.ts";
export default { id: "cerebras", label: "Cerebras", type: "openai-compatible", baseURL: "https://api.cerebras.ai/v1", apiKeyEnv: "CEREBRAS_API_KEY", auth: "apikey" } satisfies ProviderPreset;
