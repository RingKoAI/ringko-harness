import type { ProviderPreset } from "./types.ts";
export default { id: "featherless", label: "Featherless AI", type: "openai-compatible", baseURL: "https://api.featherless.ai/v1", apiKeyEnv: "FEATHERLESS_API_KEY", auth: "apikey" } satisfies ProviderPreset;
