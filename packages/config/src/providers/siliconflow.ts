import type { ProviderPreset } from "./types.ts";
export default { id: "siliconflow", label: "SiliconFlow", type: "openai-compatible", baseURL: "https://api.siliconflow.cn/v1", apiKeyEnv: "SILICONFLOW_API_KEY", auth: "apikey" } satisfies ProviderPreset;
