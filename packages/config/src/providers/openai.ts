import type { ProviderPreset } from "./types.ts";
export default { id: "openai", label: "OpenAI", type: "openai", apiKeyEnv: "OPENAI_API_KEY", auth: "apikey", docs: "https://platform.openai.com/docs" } satisfies ProviderPreset;
