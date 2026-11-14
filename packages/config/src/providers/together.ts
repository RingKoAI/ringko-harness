import type { ProviderPreset } from "./types.ts";
export default { id: "together", label: "Together AI", type: "openai-compatible", baseURL: "https://api.together.xyz/v1", apiKeyEnv: "TOGETHER_API_KEY", auth: "apikey" } satisfies ProviderPreset;
