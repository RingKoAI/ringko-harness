import type { ProviderPreset } from "./types.ts";
export default { id: "vercel-ai-gateway", label: "Vercel AI Gateway", type: "openai-compatible", baseURL: "https://ai-gateway.vercel.sh/v1", apiKeyEnv: "AI_GATEWAY_API_KEY", auth: "apikey" } satisfies ProviderPreset;
