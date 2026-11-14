import type { LanguageModel } from "ai";
import type { ModelClient } from "@ringko-ai/harness";
import { createAiSdkModelClient } from "./ai-sdk.ts";
import { requireProviderAdapter } from "./registry.ts";
import type { ProviderClientOptions } from "./types.ts";

export * from "./ai-sdk.ts";
export * from "./openai/index.ts";
export * from "./github-copilot/index.ts";
export * from "./anthropic/index.ts";
export * from "./xai/index.ts";
export * from "./models.ts";
export type { ProviderName } from "./registry.ts";
export { canonicalProviderType } from "./registry.ts";
export type { ProviderClientOptions } from "./types.ts";

/** Public entry points dispatch through registrations; provider behavior stays in its module. */
export function resolveProviderModel(options: ProviderClientOptions): LanguageModel {
  return requireProviderAdapter(options.provider).resolveModel(options);
}
export function createProviderClient(options: ProviderClientOptions): ModelClient {
  if (!options || typeof options.model !== "string" || options.model.trim().length === 0) throw new TypeError("createProviderClient requires a model id.");
  const adapter = requireProviderAdapter(options.provider);
  return adapter.createClient ? adapter.createClient(options) : createAiSdkModelClient(adapter.resolveModel(options), { ...options, ...(adapter.forceStream ? { stream: true } : {}) });
}
