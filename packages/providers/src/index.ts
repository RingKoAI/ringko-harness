import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { ModelClient } from "@ringko-ai/harness";
import { createAiSdkModelClient, type AiSdkModelOptions } from "./ai-sdk.ts";

export * from "./ai-sdk.ts";

/**
 * Providers wired through the AI SDK. `openai-compatible` targets any
 * OpenAI-compatible chat-completions endpoint (a self-hosted or proxy gateway),
 * which is how custom endpoints are configured.
 */
export type ProviderName = "openai" | "anthropic" | "openai-compatible";

export interface ProviderClientOptions extends AiSdkModelOptions {
  /** Provider kind, or a vendor id mapped by the caller. */
  provider: string;
  /** Model id, e.g. "gpt-4o-mini" or "fktx/deepseek-v4-pro". */
  model: string;
  /** Human-readable provider name (used by openai-compatible). */
  name?: string;
  /** Base URL for openai-compatible endpoints, e.g. "https://host/v1". */
  baseURL?: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

/** Resolve a provider + model id into an AI SDK language model. */
export function resolveProviderModel(options: ProviderClientOptions): LanguageModel {
  switch (options.provider) {
    case "openai":
      return openai(options.model);
    case "anthropic":
      return anthropic(options.model);
    case "openai-compatible": {
      if (!options.baseURL) {
        throw new TypeError('Provider "openai-compatible" requires a baseURL.');
      }
      const provider = createOpenAICompatible({
        name: options.name ?? "openai-compatible",
        baseURL: options.baseURL,
        ...(options.apiKey ? { apiKey: options.apiKey } : {}),
        ...(options.headers ? { headers: options.headers } : {}),
      });
      return provider.chatModel(options.model);
    }
    default:
      throw new TypeError(`Unknown provider "${String(options.provider)}".`);
  }
}

/** Create a harness model client backed by a provider via the AI SDK. */
export function createProviderClient(options: ProviderClientOptions): ModelClient {
  if (!options || typeof options.model !== "string" || options.model.trim().length === 0) {
    throw new TypeError("createProviderClient requires a model id.");
  }
  return createAiSdkModelClient(resolveProviderModel(options), options);
}
