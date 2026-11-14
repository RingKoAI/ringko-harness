import type { ProviderPreset } from "./types.ts";
export default { id: "jan", label: "Jan (local)", type: "openai-compatible", baseURL: "http://localhost:1337/v1", auth: "apikey" } satisfies ProviderPreset;
