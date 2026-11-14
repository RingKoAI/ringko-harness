import type { ProviderPreset } from "./types.ts";
export default { id: "requesty", label: "Requesty", type: "openai-compatible", baseURL: "https://router.requesty.ai/v1", apiKeyEnv: "REQUESTY_API_KEY", auth: "apikey" } satisfies ProviderPreset;
