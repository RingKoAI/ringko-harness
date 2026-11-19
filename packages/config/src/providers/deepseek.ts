import type { ProviderPreset } from "./types.ts";
export default {
  id: "deepseek",
  label: "DeepSeek",
  type: "openai-compatible",
  builtin: true,
  baseURL: "https://api.deepseek.com/v1",
  apiKeyEnv: "DEEPSEEK_API_KEY",
  apiKeyUrl: "https://platform.deepseek.com/api_keys",
  auth: "apikey",
  defaultModels: [
    { id: "deepseek-chat", name: "DeepSeek V3 (Chat)" },
    { id: "deepseek-reasoner", name: "DeepSeek R1 (Reasoner)" },
  ],
} satisfies ProviderPreset;
