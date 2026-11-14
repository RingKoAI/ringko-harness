import type { ProviderPreset } from "./types.ts";
export default { id: "moonshotai-cn", label: "Moonshot (Kimi, CN)", type: "openai-compatible", baseURL: "https://api.moonshot.cn/v1", apiKeyEnv: "MOONSHOT_API_KEY", auth: "apikey" } satisfies ProviderPreset;
