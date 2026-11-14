import type { ProviderPreset } from "./types.ts";
export default { id: "zai", label: "Z.ai (GLM)", type: "openai-compatible", baseURL: "https://api.z.ai/api/paas/v4", apiKeyEnv: "ZAI_API_KEY", auth: "apikey" } satisfies ProviderPreset;
