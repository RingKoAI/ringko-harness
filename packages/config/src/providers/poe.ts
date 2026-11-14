import type { ProviderPreset } from "./types.ts";
export default { id: "poe", label: "Poe", type: "openai-compatible", baseURL: "https://api.poe.com/v1", apiKeyEnv: "POE_API_KEY", auth: "apikey" } satisfies ProviderPreset;
