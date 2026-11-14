import type { ProviderPreset } from "./types.ts";
export default { id: "baseten", label: "Baseten", type: "openai-compatible", baseURL: "https://inference.baseten.co/v1", apiKeyEnv: "BASETEN_API_KEY", auth: "apikey" } satisfies ProviderPreset;
