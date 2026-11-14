import type { ProviderPreset } from "./types.ts";
export default { id: "google", label: "Google (Gemini)", type: "google", apiKeyEnv: "GEMINI_API_KEY", auth: "apikey", docs: "https://ai.google.dev" } satisfies ProviderPreset;
