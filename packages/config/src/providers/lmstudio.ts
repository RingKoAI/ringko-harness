import type { ProviderPreset } from "./types.ts";
export default {
  id: "lmstudio",
  label: "LM Studio (local)",
  type: "openai-compatible",
  builtin: true,
  baseURL: "http://127.0.0.1:1234/v1",
  auth: "apikey",
  docs: "https://lmstudio.ai",
  defaultModels: [
    { id: "qwen2.5-coder-7b-instruct", name: "Qwen2.5 Coder 7B" },
  ],
} satisfies ProviderPreset;
