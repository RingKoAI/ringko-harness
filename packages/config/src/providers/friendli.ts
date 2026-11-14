import type { ProviderPreset } from "./types.ts";
export default { id: "friendli", label: "FriendliAI", type: "openai-compatible", baseURL: "https://api.friendli.ai/serverless/v1", apiKeyEnv: "FRIENDLI_TOKEN", auth: "apikey" } satisfies ProviderPreset;
