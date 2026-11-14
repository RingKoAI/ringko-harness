import type { ProviderPreset } from "./types.ts";
export default { id: "fireworks", label: "Fireworks AI", type: "openai-compatible", baseURL: "https://api.fireworks.ai/inference/v1", apiKeyEnv: "FIREWORKS_API_KEY", auth: "apikey" } satisfies ProviderPreset;
