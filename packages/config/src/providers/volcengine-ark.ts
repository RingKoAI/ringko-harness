import type { ProviderPreset } from "./types.ts";
export default { id: "volcengine-ark", label: "Volcengine Ark (Doubao)", type: "openai-compatible", baseURL: "https://ark.cn-beijing.volces.com/api/v3", apiKeyEnv: "ARK_API_KEY", auth: "apikey" } satisfies ProviderPreset;
