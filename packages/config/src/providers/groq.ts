import type { ProviderPreset } from "./types.ts";
export default {
  id: "groq",
  label: "Groq",
  type: "openai-compatible",
  builtin: true,
  baseURL: "https://api.groq.com/openai/v1",
  apiKeyEnv: "GROQ_API_KEY",
  apiKeyUrl: "https://console.groq.com/keys",
  auth: "apikey",
  defaultModels: [
    { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
    { id: "qwen/qwen3-32b", name: "Qwen3 32B" },
  ],
} satisfies ProviderPreset;
