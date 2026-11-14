import type { ProviderPreset } from "./types.ts";
export default { id: "vllm", label: "vLLM (local)", type: "openai-compatible", baseURL: "http://localhost:8000/v1", auth: "apikey" } satisfies ProviderPreset;
