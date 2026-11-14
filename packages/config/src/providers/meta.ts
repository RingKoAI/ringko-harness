import type { ProviderPreset } from "./types.ts";
export default { id: "meta", label: "Meta Llama API", type: "openai-compatible", baseURL: "https://api.llama.com/compat/v1", apiKeyEnv: "LLAMA_API_KEY", auth: "apikey" } satisfies ProviderPreset;
