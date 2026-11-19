import type { ProviderPreset } from "./types.ts";
export default {
  id: "moonshotai-cn",
  label: "Moonshot (Kimi, CN)",
  type: "openai-compatible",
  builtin: true,
  baseURL: "https://api.moonshot.cn/v1",
  apiKeyEnv: "MOONSHOT_API_KEY",
  apiKeyUrl: "https://platform.moonshot.cn/console/api-keys",
  auth: "apikey",
  defaultModels: [
    { id: "kimi-k2-0905-preview", name: "Kimi K2" },
    { id: "moonshot-v1-auto", name: "Moonshot v1 Auto" },
  ],
} satisfies ProviderPreset;
