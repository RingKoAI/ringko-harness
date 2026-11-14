import type { ProviderPreset } from "./types.ts";
export default { id: "huggingface", label: "Hugging Face", type: "openai-compatible", baseURL: "https://router.huggingface.co/v1", apiKeyEnv: "HF_TOKEN", auth: "apikey" } satisfies ProviderPreset;
