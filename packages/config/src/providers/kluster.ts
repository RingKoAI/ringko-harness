import type { ProviderPreset } from "./types.ts";
export default { id: "kluster", label: "Kluster.ai", type: "openai-compatible", baseURL: "https://api.kluster.ai/v1", apiKeyEnv: "KLUSTER_API_KEY", auth: "apikey" } satisfies ProviderPreset;
