import type { ProviderPreset } from "./types.ts";
export default { id: "deepinfra", label: "DeepInfra", type: "openai-compatible", baseURL: "https://api.deepinfra.com/v1/openai", apiKeyEnv: "DEEPINFRA_API_KEY", auth: "apikey" } satisfies ProviderPreset;
