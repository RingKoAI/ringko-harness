import type { ModelDefinition, ProviderDefinition } from "./config.ts";

export const MODEL_CATALOG_LIMITS = {
  bytes: 32 * 1024 * 1024,
  providers: 1024,
  models: 100_000,
  id: 1024,
  name: 512,
  url: 4096,
} as const;

export interface ModelMetadata {
  id: string;
  name?: string;
  canonical_model_id?: string;
  limit: { context?: number; input?: number; output?: number };
}
export interface MetadataProvider { api?: string; models: Record<string, ModelMetadata> }
export type ModelMetadataCatalog = Record<string, MetadataProvider>;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value);
}
export function validTokenLimit(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Retain only bounded identity and token-limit metadata from the public directory. */
export function parseModelMetadata(value: unknown): ModelMetadataCatalog {
  const source = record(value);
  if (!source || Object.keys(source).length > MODEL_CATALOG_LIMITS.providers) throw new Error("Invalid model catalog providers.");
  const result: ModelMetadataCatalog = Object.create(null);
  let count = 0;
  for (const [providerId, value] of Object.entries(source)) {
    if (!text(providerId, MODEL_CATALOG_LIMITS.id)) continue;
    const provider = record(value), models = record(provider?.models);
    if (!provider || !models) continue;
    const entries: Record<string, ModelMetadata> = Object.create(null);
    for (const [id, value] of Object.entries(models)) {
      if (++count > MODEL_CATALOG_LIMITS.models) throw new Error("Model catalog exceeds the model limit.");
      if (!text(id, MODEL_CATALOG_LIMITS.id)) continue;
      const model = record(value), limits = record(model?.limit);
      if (!model || !limits) continue;
      const limit: ModelMetadata["limit"] = {};
      for (const field of ["context", "input", "output"] as const) if (validTokenLimit(limits[field])) limit[field] = limits[field];
      if (!Object.keys(limit).length) continue;
      entries[id] = {
        id,
        ...(text(model.name, MODEL_CATALOG_LIMITS.name) ? { name: model.name } : {}),
        ...(text(model.canonical_model_id, MODEL_CATALOG_LIMITS.id) ? { canonical_model_id: model.canonical_model_id } : {}),
        limit,
      };
    }
    if (Object.keys(entries).length) result[providerId] = { ...(text(provider.api, MODEL_CATALOG_LIMITS.url) ? { api: provider.api } : {}), models: entries };
  }
  if (!Object.keys(result).length) throw new Error("Model catalog contains no usable token limits.");
  return result;
}

const PROVIDER_ALIASES: Record<string, string> = {
  "openai-oauth": "openai", oauth: "openai", chatgpt: "openai", "openai-codex": "openai",
  "anthropic-oauth": "anthropic", "claude-oauth": "anthropic",
  copilot: "github-copilot", "xai-oauth": "xai", grok: "xai",
  gemini: "google", "google-generative-ai": "google",
};

function endpoint(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return `${url.origin}${url.pathname.replace(/\/chat\/completions\/?$/, "").replace(/\/+$/, "")}`;
  } catch { return undefined; }
}

/** Match provider identity first; custom gateways may use an unambiguous canonical model. */
export function findModelMetadata(catalog: ModelMetadataCatalog, provider: ProviderDefinition, model: ModelDefinition): ModelMetadata | undefined {
  const explicit = model.catalogId;
  if (explicit) {
    const slash = explicit.indexOf("/");
    return slash > 0 ? catalog[explicit.slice(0, slash)]?.models[explicit.slice(slash + 1)] : undefined;
  }
  const type = (provider.type ?? provider.vendor ?? "").toLowerCase();
  const id = (PROVIDER_ALIASES[type] ?? type) === "google" ? model.id.replace(/^models\//, "") : model.id;
  const base = endpoint(provider.baseURL ?? model.url ?? provider.url);
  const byEndpoint = base ? Object.values(catalog).filter(entry => endpoint(entry.api) === base) : [];
  if (byEndpoint.length) {
    for (const key of [provider.name.toLowerCase(), PROVIDER_ALIASES[type] ?? type]) {
      if (byEndpoint.includes(catalog[key]) && catalog[key]?.models[id]) return catalog[key].models[id];
    }
    const matches = byEndpoint.map(entry => entry.models[id]).filter((entry): entry is ModelMetadata => Boolean(entry));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return undefined;
  }
  for (const key of [provider.name.toLowerCase(), PROVIDER_ALIASES[type] ?? type]) {
    const found = catalog[key]?.models[id];
    if (found) return found;
  }
  const slash = id.indexOf("/");
  if (slash > 0) {
    const found = catalog[id.slice(0, slash)]?.models[id.slice(slash + 1)];
    if (found) return found;
  }
  const canonical = new Set<string>();
  for (const entry of Object.values(catalog)) {
    const candidate = entry.models[id]?.canonical_model_id;
    if (candidate) canonical.add(candidate);
  }
  if (canonical.size !== 1) return undefined;
  const [key] = canonical;
  const split = key.indexOf("/");
  return split > 0 ? catalog[key.slice(0, split)]?.models[key.slice(split + 1)] : undefined;
}
