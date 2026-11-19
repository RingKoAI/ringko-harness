import type { ProviderPreset } from "./types.ts";
export default {
  id: "minimax-cn",
  label: "MiniMax (CN)",
  type: "openai-compatible",
  builtin: true,
  baseURL: "https://api.minimaxi.com/v1",
  apiKeyEnv: "MINIMAX_API_KEY",
  apiKeyUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
  auth: "apikey",
  defaultModels: [
    { id: "MiniMax-M1", name: "MiniMax M1" },
    { id: "MiniMax-Text-01", name: "MiniMax Text 01" },
  ],
} satisfies ProviderPreset;
