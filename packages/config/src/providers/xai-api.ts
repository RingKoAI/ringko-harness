import type { ProviderPreset } from "./types.ts";
export default {
  id: "xai-api",
  label: "xAI (Grok)",
  type: "openai-compatible",
  builtin: true,
  baseURL: "https://api.x.ai/v1",
  apiKeyEnv: "XAI_API_KEY",
  apiKeyUrl: "https://console.x.ai",
  auth: "apikey",
  defaultModels: [
    { id: "grok-4", name: "Grok 4" },
    { id: "grok-3-mini", name: "Grok 3 Mini" },
  ],
} satisfies ProviderPreset;
