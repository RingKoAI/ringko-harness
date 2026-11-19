import type { ProviderPreset } from "./types.ts";
export default {
  id: "ollama",
  label: "Ollama (local)",
  type: "openai-compatible",
  builtin: true,
  baseURL: "http://127.0.0.1:11434/v1",
  auth: "apikey",
  docs: "https://ollama.com",
  defaultModels: [
    { id: "qwen3:8b", name: "Qwen3 8B" },
    { id: "deepseek-r1:8b", name: "DeepSeek R1 8B" },
  ],
} satisfies ProviderPreset;
