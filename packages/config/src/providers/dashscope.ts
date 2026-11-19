import type { ProviderPreset } from "./types.ts";
export default {
  id: "dashscope",
  label: "Alibaba Cloud (DashScope)",
  type: "openai-compatible",
  builtin: true,
  baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  apiKeyEnv: "DASHSCOPE_API_KEY",
  apiKeyUrl: "https://bailian.console.aliyun.com/?apiKey=1",
  auth: "apikey",
  defaultModels: [
    { id: "qwen3-coder-plus", name: "Qwen3 Coder Plus" },
    { id: "qwen-max-latest", name: "Qwen Max" },
  ],
} satisfies ProviderPreset;
