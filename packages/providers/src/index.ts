import { anthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI, google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { ModelClient } from "@ringko-ai/harness";
import { createAiSdkModelClient, type AiSdkModelOptions } from "./ai-sdk.ts";
import { resolveAnthropicOauthModel } from "./anthropic/index.ts";
import { resolveGitHubCopilotModel } from "./github-copilot/index.ts";
import { resolveOpenAiOauthModel } from "./openai/index.ts";
import { resolveXaiOauthModel } from "./xai/index.ts";
import { resolveGoogleOauthModel } from "./google/index.ts";

export * from "./ai-sdk.ts";
export * from "./openai/index.ts";
export * from "./github-copilot/index.ts";
export * from "./anthropic/index.ts";
export * from "./xai/index.ts";
export * from "./models.ts";

/**
 * Providers wired through the AI SDK. `openai-compatible` targets any
 * OpenAI-compatible chat-completions endpoint (a self-hosted or proxy gateway),
 * which is how custom endpoints are configured.
 */
export type ProviderName =
  | "openai"
  | "openai-oauth"
  | "github-copilot"
  | "anthropic"
  | "anthropic-oauth"
  | "xai-oauth"
  | "google"
  | "google-gemini-cli"
  | "openai-compatible";

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
    case "openai-oauth":
      return resolveOpenAiOauthModel(options.model);
    case "github-copilot":
      return resolveGitHubCopilotModel(options.model);
    case "xai-oauth":
      return resolveXaiOauthModel(options.model);
    case "anthropic":
      return anthropic(options.model);
    case "anthropic-oauth":
      return resolveAnthropicOauthModel(options.model);
    case "google": {
      if (options.apiKey || options.baseURL) {
        const provider = createGoogleGenerativeAI({
          ...(options.apiKey ? { apiKey: options.apiKey } : {}),
          ...(options.baseURL ? { baseURL: options.baseURL } : {}),
        });
        return provider(options.model);
      }
      return google(options.model);
    }
    case "google-gemini-cli":
      return resolveGoogleOauthModel(options.model);
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
  // The Codex `/responses` backend only accepts `stream: true`, so the OpenAI
  // OAuth route uses the streaming transport and resolves one completion.
  return createAiSdkModelClient(resolveProviderModel(options), {
    ...options,
    ...(options.provider === "openai-oauth" ? { stream: true } : {}),
  });
}
