import type { ProviderPreset } from "./types.ts";
export default { id: "qianfan", label: "Baidu Qianfan", type: "openai-compatible", baseURL: "https://qianfan.baidubce.com/v2", apiKeyEnv: "QIANFAN_API_KEY", auth: "apikey" } satisfies ProviderPreset;
