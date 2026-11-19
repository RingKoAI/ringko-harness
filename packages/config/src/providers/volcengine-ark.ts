import type { ProviderPreset } from "./types.ts";
export default {
  id: "volcengine-ark",
  label: "Volcengine Ark (Doubao)",
  type: "openai-compatible",
  builtin: true,
  baseURL: "https://ark.cn-beijing.volces.com/api/v3",
  apiKeyEnv: "ARK_API_KEY",
  apiKeyUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
  auth: "apikey",
  defaultModels: [
    { id: "doubao-seed-1-6-250615", name: "Doubao Seed 1.6" },
    { id: "deepseek-v3-250324", name: "DeepSeek V3 (Ark)" },
  ],
} satisfies ProviderPreset;
