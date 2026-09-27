import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { ModelClient } from "@ringko-ai/harness";
import { createAiSdkModelClient, type AiSdkModelOptions } from "./ai-sdk.ts";

export * from "./ai-sdk.ts";

/** Providers wired through the AI SDK. API keys come from the environment. */
export type ProviderName = "openai" | "anthropic";

export interface ProviderModelOptions {
  provider: ProviderName;
  model: string;
}

/** Resolve a provider + model id into an AI SDK language model. */
export function resolveProviderModel({ provider, model }: ProviderModelOptions): LanguageModel {
  switch (provider) {
    case "openai":
      return openai(model);
    case "anthropic":
      return anthropic(model);
    default:
      throw new TypeError(`Unknown provider "${String(provider)}".`);
  }
}

export interface CreateProviderClientOptions extends ProviderModelOptions, AiSdkModelOptions {}

/** Create a harness model client backed by a hosted provider via the AI SDK. */
export function createProviderClient(options: CreateProviderClientOptions): ModelClient {
  return createAiSdkModelClient(resolveProviderModel(options), options);
}
