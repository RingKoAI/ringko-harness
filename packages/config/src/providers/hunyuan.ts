import type { ProviderPreset } from "./types.ts";
export default { id: "hunyuan", label: "Tencent Hunyuan", type: "openai-compatible", baseURL: "https://api.hunyuan.cloud.tencent.com/v1", apiKeyEnv: "HUNYUAN_API_KEY", auth: "apikey" } satisfies ProviderPreset;
