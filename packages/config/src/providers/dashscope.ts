import type { ProviderPreset } from "./types.ts";
export default { id: "dashscope", label: "Alibaba Cloud (DashScope)", type: "openai-compatible", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", apiKeyEnv: "DASHSCOPE_API_KEY", auth: "apikey" } satisfies ProviderPreset;
