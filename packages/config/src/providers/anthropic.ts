import type { ProviderPreset } from "./types.ts";
export default { id: "anthropic", label: "Anthropic (Claude)", type: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY", auth: "apikey", docs: "https://docs.anthropic.com" } satisfies ProviderPreset;
