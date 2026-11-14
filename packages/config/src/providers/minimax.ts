import type { ProviderPreset } from "./types.ts";
export default { id: "minimax", label: "MiniMax", type: "openai-compatible", baseURL: "https://api.minimax.io/v1", apiKeyEnv: "MINIMAX_API_KEY", auth: "apikey" } satisfies ProviderPreset;
