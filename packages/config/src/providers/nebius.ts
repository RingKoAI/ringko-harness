import type { ProviderPreset } from "./types.ts";
export default { id: "nebius", label: "Nebius AI Studio", type: "openai-compatible", baseURL: "https://api.studio.nebius.ai/v1", apiKeyEnv: "NEBIUS_API_KEY", auth: "apikey" } satisfies ProviderPreset;
