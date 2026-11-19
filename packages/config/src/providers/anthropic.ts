import type { ProviderPreset } from "./types.ts";
export default {
  id: "anthropic",
  label: "Anthropic (Claude)",
  type: "anthropic",
  builtin: true,
  defaultBaseURL: "https://api.anthropic.com/v1",
  apiKeyEnv: "ANTHROPIC_API_KEY",
  apiKeyUrl: "https://console.anthropic.com/settings/keys",
  auth: "apikey",
  docs: "https://docs.anthropic.com",
  defaultModels: [
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
  ],
} satisfies ProviderPreset;
