import type { ProviderPreset } from "./types.ts";
export default {
  id: "openai",
  label: "OpenAI",
  type: "openai",
  builtin: true,
  defaultBaseURL: "https://api.openai.com/v1",
  apiKeyEnv: "OPENAI_API_KEY",
  apiKeyUrl: "https://platform.openai.com/api-keys",
  auth: "apikey",
  docs: "https://platform.openai.com/docs",
  defaultModels: [
    { id: "gpt-5", name: "GPT-5" },
    { id: "gpt-5-mini", name: "GPT-5 Mini" },
    { id: "o4-mini", name: "o4-mini" },
  ],
} satisfies ProviderPreset;
