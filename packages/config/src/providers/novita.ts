import type { ProviderPreset } from "./types.ts";
export default { id: "novita", label: "Novita AI", type: "openai-compatible", baseURL: "https://api.novita.ai/v3/openai", apiKeyEnv: "NOVITA_API_KEY", auth: "apikey" } satisfies ProviderPreset;
