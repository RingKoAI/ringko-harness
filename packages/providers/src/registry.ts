import openai from "./openai.ts";
import openaiOauth from "./openai-oauth.ts";
import anthropic from "./anthropic.ts";
import anthropicOauth from "./anthropic-oauth.ts";
import google from "./google.ts";
import githubCopilot from "./github-copilot.ts";
import xaiOauth from "./xai-oauth.ts";
import openaiCompatible from "./openai-compatible.ts";
import opencodeGo from "./opencode-go.ts";
import type { ProviderAdapter } from "./types.ts";

const PROVIDER_ADAPTERS = {
  openai,
  "openai-oauth": openaiOauth,
  anthropic,
  "anthropic-oauth": anthropicOauth,
  google,
  "github-copilot": githubCopilot,
  "xai-oauth": xaiOauth,
  "openai-compatible": openaiCompatible,
  "opencode-go": opencodeGo,
} satisfies Record<string, ProviderAdapter>;

export type ProviderName = keyof typeof PROVIDER_ADAPTERS;

const TYPE_ALIASES: Record<string, string> = Object.fromEntries(Object.entries(PROVIDER_ADAPTERS).flatMap(([id, adapter]: [string, ProviderAdapter]) => [[id, id], ...(adapter.aliases ?? []).map(alias => [alias, id])]));

export function canonicalProviderType(type: string): string {
  return Object.hasOwn(TYPE_ALIASES, type) ? TYPE_ALIASES[type] : type;
}
export function getProviderAdapter(type: string): ProviderAdapter | undefined {
  return Object.hasOwn(PROVIDER_ADAPTERS, type) ? PROVIDER_ADAPTERS[type as ProviderName] : undefined;
}
export function requireProviderAdapter(type: string): ProviderAdapter {
  const adapter = getProviderAdapter(type);
  if (!adapter) throw new TypeError(`Unknown provider "${String(type)}".`);
  return adapter;
}
