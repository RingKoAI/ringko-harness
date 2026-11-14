import type { ProviderPreset } from "./types.ts";
export default { id: "llama-cpp", label: "llama.cpp server (local)", type: "openai-compatible", baseURL: "http://localhost:8080/v1", auth: "apikey" } satisfies ProviderPreset;
