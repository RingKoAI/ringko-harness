import type { ProviderPreset } from "./types.ts";
export default { id: "ai21", label: "AI21 Labs", type: "openai-compatible", baseURL: "https://api.ai21.com/studio/v1", apiKeyEnv: "AI21_API_KEY", auth: "apikey" } satisfies ProviderPreset;
