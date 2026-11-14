import type { ProviderPreset } from "./types.ts";
export default { id: "github-models", label: "GitHub Models", type: "openai-compatible", baseURL: "https://models.github.ai/inference", apiKeyEnv: "GITHUB_TOKEN", auth: "apikey" } satisfies ProviderPreset;
