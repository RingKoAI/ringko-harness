import type { ProviderPreset } from "./types.ts";
export default { id: "lmstudio", label: "LM Studio (local)", type: "openai-compatible", baseURL: "http://127.0.0.1:1234/v1", auth: "apikey" } satisfies ProviderPreset;
