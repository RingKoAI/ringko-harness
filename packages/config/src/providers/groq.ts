import type { ProviderPreset } from "./types.ts";
export default { id: "groq", label: "Groq", type: "openai-compatible", baseURL: "https://api.groq.com/openai/v1", apiKeyEnv: "GROQ_API_KEY", auth: "apikey" } satisfies ProviderPreset;
