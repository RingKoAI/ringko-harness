// Resolve the configured provider/model into a harness model client.
import { getApiKey, selectModel, type ModelSelection, type RingkoConfig } from "@ringko-ai/config";
import { createProviderClient } from "@ringko-ai/providers";
import type { ModelClient } from "@ringko-ai/sdk";

const TYPE_ALIASES: Record<string, string> = {
  openai: "openai",
  "openai-oauth": "openai-oauth",
  oauth: "openai-oauth",
  chatgpt: "openai-oauth",
  "github-copilot": "github-copilot",
  copilot: "github-copilot",
  "xai-oauth": "xai-oauth",
  xai: "xai-oauth",
  grok: "xai-oauth",
  anthropic: "anthropic",
  "anthropic-oauth": "anthropic-oauth",
  "claude-oauth": "anthropic-oauth",
  google: "google",
  "google-gemini-cli": "google-gemini-cli",
  "google-oauth": "google-gemini-cli",
  gemini: "google",
  "openai-compatible": "openai-compatible",
  openaicompatible: "openai-compatible",
  compatible: "openai-compatible",
  customendpoint: "openai-compatible",
};

function baseUrlFromChatUrl(url: string): string {
  return url.replace(/\/chat\/completions\/?$/, "").replace(/\/completions\/?$/, "");
}

export interface LoadedModel {
  client: ModelClient;
  selection: ModelSelection;
}

/** Load the configured model, or return an error string (fail closed). */
export function loadModel(config: RingkoConfig): LoadedModel | string {
  const selection = selectModel(config);
  if (!selection) return "No model configured; edit ~/.ringko/provider.json.";
  const { provider, model } = selection;
  const rawType = (provider.type ?? provider.vendor ?? "").toLowerCase();
  const type = TYPE_ALIASES[rawType] ?? "openai-compatible";
  const baseURL =
    provider.baseURL ??
    (model.url ? baseUrlFromChatUrl(model.url) : provider.url ? baseUrlFromChatUrl(provider.url) : undefined);
  try {
    const client = createProviderClient({
      provider: type,
      model: model.id,
      cacheKey: `${type}:${model.id}`,
      ...(provider.name ? { name: provider.name } : {}),
      ...(baseURL ? { baseURL } : {}),
      ...((provider.apiKey ?? getApiKey(provider.name)) ? { apiKey: provider.apiKey ?? getApiKey(provider.name) } : {}),
      ...(model.maxOutputTokens ? { maxOutputTokens: model.maxOutputTokens } : {}),
      ...(config.thinking ? { thinking: config.thinking } : {}),
    });
    return { client, selection };
  } catch (error) {
    return error instanceof Error ? error.message : "Provider initialization failed.";
  }
}
