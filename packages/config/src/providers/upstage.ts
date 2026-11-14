import type { ProviderPreset } from "./types.ts";
export default { id: "upstage", label: "Upstage", type: "openai-compatible", baseURL: "https://api.upstage.ai/v1", apiKeyEnv: "UPSTAGE_API_KEY", auth: "apikey" } satisfies ProviderPreset;
