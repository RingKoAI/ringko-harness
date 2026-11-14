import type { ProviderPreset } from "./types.ts";
export default { id: "deepseek", label: "DeepSeek", type: "openai-compatible", baseURL: "https://api.deepseek.com/v1", apiKeyEnv: "DEEPSEEK_API_KEY", auth: "apikey" } satisfies ProviderPreset;
