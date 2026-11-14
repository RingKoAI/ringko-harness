import type { ProviderPreset } from "./types.ts";
export default { id: "minimax-cn", label: "MiniMax (CN)", type: "openai-compatible", baseURL: "https://api.minimaxi.com/v1", apiKeyEnv: "MINIMAX_API_KEY", auth: "apikey" } satisfies ProviderPreset;
