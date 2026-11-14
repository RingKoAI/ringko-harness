import type { ProviderPreset } from "./types.ts";
export default { id: "hyperbolic", label: "Hyperbolic", type: "openai-compatible", baseURL: "https://api.hyperbolic.xyz/v1", apiKeyEnv: "HYPERBOLIC_API_KEY", auth: "apikey" } satisfies ProviderPreset;
