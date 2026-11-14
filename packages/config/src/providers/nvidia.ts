import type { ProviderPreset } from "./types.ts";
export default { id: "nvidia", label: "NVIDIA NIM", type: "openai-compatible", baseURL: "https://integrate.api.nvidia.com/v1", apiKeyEnv: "NVIDIA_API_KEY", auth: "apikey" } satisfies ProviderPreset;
