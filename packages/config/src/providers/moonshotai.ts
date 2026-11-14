import type { ProviderPreset } from "./types.ts";
export default { id: "moonshotai", label: "Moonshot (Kimi, global)", type: "openai-compatible", baseURL: "https://api.moonshot.ai/v1", apiKeyEnv: "MOONSHOT_API_KEY", auth: "apikey" } satisfies ProviderPreset;
