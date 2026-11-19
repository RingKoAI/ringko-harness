import type { ProviderPreset } from "./types.ts";
export default {
  id: "siliconflow",
  label: "SiliconFlow",
  type: "openai-compatible",
  builtin: true,
  baseURL: "https://api.siliconflow.cn/v1",
  apiKeyEnv: "SILICONFLOW_API_KEY",
  apiKeyUrl: "https://cloud.siliconflow.cn/account/ak",
  auth: "apikey",
  defaultModels: [
    { id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3" },
    { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1" },
    { id: "Qwen/Qwen3-Coder-480B-A35B-Instruct", name: "Qwen3 Coder 480B" },
  ],
} satisfies ProviderPreset;
