import type { ProviderPreset } from "./types.ts";
export default { id: "ollama", label: "Ollama (local)", type: "openai-compatible", baseURL: "http://127.0.0.1:11434/v1", auth: "apikey" } satisfies ProviderPreset;
