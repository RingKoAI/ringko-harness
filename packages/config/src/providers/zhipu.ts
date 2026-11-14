import type { ProviderPreset } from "./types.ts";
export default { id: "zhipu", label: "Zhipu (BigModel, CN)", type: "openai-compatible", baseURL: "https://open.bigmodel.cn/api/paas/v4", apiKeyEnv: "ZHIPUAI_API_KEY", auth: "apikey" } satisfies ProviderPreset;
