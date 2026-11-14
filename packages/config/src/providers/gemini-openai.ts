import type { ProviderPreset } from "./types.ts";
export default { id: "gemini-openai", label: "Gemini (OpenAI-compat)", type: "openai-compatible", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", apiKeyEnv: "GEMINI_API_KEY", auth: "apikey" } satisfies ProviderPreset;
