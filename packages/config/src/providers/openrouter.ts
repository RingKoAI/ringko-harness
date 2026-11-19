import type { ProviderPreset } from "./types.ts";
export default {
  id: "openrouter",
  label: "OpenRouter",
  type: "openai-compatible",
  builtin: true,
  baseURL: "https://openrouter.ai/api/v1",
  apiKeyEnv: "OPENROUTER_API_KEY",
  apiKeyUrl: "https://openrouter.ai/keys",
  auth: "apikey",
  defaultModels: [
    { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
    { id: "openai/gpt-5", name: "GPT-5" },
    { id: "deepseek/deepseek-chat-v3-0324", name: "DeepSeek V3" },
  ],
} satisfies ProviderPreset;
