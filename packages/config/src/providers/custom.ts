import type { ProviderPreset } from "./types.ts";
export default { id: "custom", label: "Custom (OpenAI-compatible)", type: "openai-compatible", auth: "apikey" } satisfies ProviderPreset;
