import type { ProviderPreset } from "./types.ts";
export default { id: "baichuan", label: "Baichuan", type: "openai-compatible", baseURL: "https://api.baichuan-ai.com/v1", apiKeyEnv: "BAICHUAN_API_KEY", auth: "apikey" } satisfies ProviderPreset;
