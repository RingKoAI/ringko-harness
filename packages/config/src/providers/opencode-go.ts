import type { ProviderPreset } from "./types.ts";

export const OPENCODE_GO = Object.freeze({
  type: "opencode-go",
  baseURL: "https://opencode.ai/inference/go/openai/v1",
  apiKeyEnv: "OPENCODE_API_KEY",
  userAgent: "ringko-harness",
  docs: "https://opencode.ai/docs/go/",
});

/** Go's public model directory is outside its protocol-specific inference root. */
export function openCodeGoModelsUrl(baseURL: string = OPENCODE_GO.baseURL): string {
  return `${baseURL.replace(/\/+$/, "").replace(/\/openai\/v1$/, "/v1")}/models`;
}

export default { id: OPENCODE_GO.type, label: "OpenCode Go", type: OPENCODE_GO.type, baseURL: OPENCODE_GO.baseURL, apiKeyEnv: OPENCODE_GO.apiKeyEnv, auth: "apikey", docs: OPENCODE_GO.docs, aliases: ["go", "opencodego"], apiKeyPolicy: { required: true, asciiOnly: true } } satisfies ProviderPreset;
