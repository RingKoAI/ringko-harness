import type { ProviderPreset } from "./types.ts";
export default { id: "azure-openai", label: "Azure OpenAI", type: "openai-compatible", baseURL: "https://YOUR-RESOURCE.openai.azure.com/openai/v1", apiKeyEnv: "AZURE_OPENAI_API_KEY", auth: "apikey" } satisfies ProviderPreset;
