import { readFileSync } from "node:fs";
import { getApiKey, loadAuth, removeApiKey, setApiKey } from "./auth.ts";
import { saveConfigFile, saveProviders, type ProviderDefinition, type RingkoConfig } from "./config.ts";
import { authPath } from "./paths.ts";
import { isRecord } from "./util.ts";
import { PROVIDER_PRESETS } from "./presets.ts";

export const PROVIDER_CONNECT_LIMITS = { name: 128, url: 4096, key: 4096, model: 1024, models: 500 } as const;
export interface ProviderConnectionInput { name: string; type: string; baseURL?: string; apiKey?: string; modelIds?: string[] }
export class ProviderConnectionError extends Error {}
const API_TYPES = new Set(PROVIDER_PRESETS.filter(preset => preset.auth === "apikey").map(preset => preset.type));

/** Explicit and stored credentials win; preset environment variables stay out of files. */
export function resolveProviderApiKey(provider: ProviderDefinition, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (typeof provider.apiKey === "string" && provider.apiKey.length) return provider.apiKey;
  const saved = getApiKey(provider.name, env);
  if (typeof saved === "string" && saved.length) return saved;
  const type = provider.type ?? provider.vendor;
  const preset = PROVIDER_PRESETS.find(entry => entry.auth === "apikey" && entry.type === type && (entry.id === provider.name || type !== "openai-compatible" || provider.baseURL !== undefined && entry.baseURL?.replace(/\/+$/, "") === provider.baseURL.replace(/\/+$/, "")));
  return preset?.apiKeyEnv ? env[preset.apiKeyEnv] : undefined;
}

export function validateProviderConnectionCredentials(provider: ProviderDefinition, env: NodeJS.ProcessEnv = process.env): void {
  const preset = PROVIDER_PRESETS.find(entry => entry.type === provider.type && entry.apiKeyPolicy && (entry.type !== "openai-compatible" || entry.id === provider.name || entry.baseURL === provider.baseURL));
  if (!preset?.apiKeyPolicy) return;
  const key = resolveProviderApiKey(provider, env);
  if (preset.apiKeyPolicy.required && !key || key !== undefined && preset.apiKeyPolicy.asciiOnly && /[^\x21-\x7e]/.test(key)) throw new ProviderConnectionError(`Enter a valid ${preset.label} API key, save one in auth storage${preset.apiKeyEnv ? `, or set ${preset.apiKeyEnv}` : ""}.`);
}

/** Validate operator input before discovery, credential writes or configuration changes. */
export function parseProviderConnection(value: unknown): ProviderConnectionInput {
  if (!isRecord(value) || typeof value.name !== "string" || !value.name.trim() || value.name.length > PROVIDER_CONNECT_LIMITS.name || /[\\/\u0000-\u001f]/.test(value.name) || ["__proto__", "prototype", "constructor"].includes(value.name.trim())) throw new ProviderConnectionError("Enter a valid provider name without slashes (up to 128 characters).");
  if (typeof value.type !== "string" || !API_TYPES.has(value.type)) throw new ProviderConnectionError("Select an API-key provider preset; use /login for OAuth.");
  const result: ProviderConnectionInput = { name: value.name.trim(), type: value.type };
  if (value.baseURL !== undefined && value.baseURL !== "") {
    if (typeof value.baseURL !== "string" || value.baseURL.length > PROVIDER_CONNECT_LIMITS.url || /[\u0000-\u001f\u007f]/.test(value.baseURL)) throw new ProviderConnectionError("Enter a valid HTTP(S) base URL.");
    let url: URL;
    try { url = new URL(value.baseURL); } catch { throw new ProviderConnectionError("Enter a valid HTTP(S) base URL."); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new ProviderConnectionError("Use an HTTP(S) base URL without credentials, query or fragment.");
    result.baseURL = url.toString().replace(/\/+$/, "");
  }
  if (result.type === "openai-compatible" && !result.baseURL) throw new ProviderConnectionError("This provider requires a base URL.");
  if (value.apiKey !== undefined && value.apiKey !== "") {
    if (typeof value.apiKey !== "string" || value.apiKey.length > PROVIDER_CONNECT_LIMITS.key || /[^\x21-\x7e]/.test(value.apiKey)) throw new ProviderConnectionError("API key must contain visible ASCII characters without spaces.");
    result.apiKey = value.apiKey;
  }
  if (value.modelIds !== undefined) {
    if (!Array.isArray(value.modelIds) || value.modelIds.length > PROVIDER_CONNECT_LIMITS.models || value.modelIds.some(id => typeof id !== "string" || !id.trim() || id.length > PROVIDER_CONNECT_LIMITS.model || /[\u0000-\u001f]/.test(id))) throw new ProviderConnectionError("Enter valid model IDs (up to 500 models).");
    result.modelIds = [...new Set(value.modelIds.map(id => (id as string).trim()))];
  }
  return result;
}

/** Atomic files with synchronous commit/credential rollback in the owning backend process. */
export function saveProviderConnection(config: RingkoConfig, input: ProviderConnectionInput, models: readonly { id: string; name?: string }[], options: { path?: string; env?: NodeJS.ProcessEnv } = {}): { config: RingkoConfig; provider: ProviderDefinition } {
  const env = options.env ?? process.env;
  const validated = parseProviderConnection({ ...input, modelIds: models.map(model => model.id) });
  if (!validated.modelIds?.length) throw new ProviderConnectionError("No models found. Enter model IDs or retry discovery.");
  const existing = config.providers?.find(provider => provider.name === validated.name);
  validateProviderConnectionCredentials({ ...validated, apiKey: validated.apiKey ?? existing?.apiKey }, env);
  if (existing?.module && existing.type !== validated.type) throw new ProviderConnectionError("Custom-module provider protocols must be changed in provider settings.");
  const provider: ProviderDefinition = { ...existing, name: validated.name, type: validated.type, ...(validated.baseURL ? { baseURL: validated.baseURL } : {}) };
  if (!validated.baseURL) { delete provider.baseURL; delete provider.url; }
  const byId = new Map(models.map(model => [model.id.trim(), model]));
  const existingModels = new Map(existing?.models?.map(model => [model.id, model]));
  provider.models = validated.modelIds.map(id => existingModels.get(id) ?? { id, name: byId.get(id)?.name ?? id });
  const retained = new Set(validated.modelIds);
  for (const model of existing?.models ?? []) if (!retained.has(model.id)) { provider.models.push(model); retained.add(model.id); }
  if (validated.apiKey) delete provider.apiKey;
  const next = { ...config, providers: [...(config.providers ?? []).filter(entry => entry.name !== provider.name), provider] };
  if (!next.model) next.model = `${provider.name}/${provider.models[0]!.id}`;
  let previousKey: string | undefined;
  if (validated.apiKey) {
    // Do not let loadAuth's legacy best-effort reader replace a corrupt credential file.
    try {
      const stored: unknown = JSON.parse(readFileSync(authPath(env), "utf8"));
      if (!isRecord(stored) || stored.apikeys !== undefined && !isRecord(stored.apikeys) || stored.oauth !== undefined && !isRecord(stored.oauth)) throw new Error("Invalid credential store.");
      const loaded = loadAuth(env);
      const loadedCount = Object.keys(loaded.apikeys).length + Object.values(loaded.oauth).reduce((count, domain) => count + domain.accounts.length, 0);
      const expectedCount = stored.oauth !== undefined || stored.apikeys !== undefined
        ? Object.keys(stored.apikeys ?? {}).length + Object.values(stored.oauth ?? {}).reduce<number>((count, domain) => { if (!isRecord(domain) || !Array.isArray(domain.accounts)) throw new Error("Invalid OAuth domain."); return count + domain.accounts.length; }, 0)
        : Object.keys(stored).length;
      if (loadedCount !== expectedCount) throw new Error("Credential entries could not be preserved.");
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new ProviderConnectionError("Cannot read the credential store. Repair auth.json before connecting."); }
    previousKey = loadAuth(env).apikeys[provider.name];
    try { setApiKey(provider.name, validated.apiKey, env); }
    catch { throw new ProviderConnectionError("Cannot save the API key. Check credential storage and retry."); }
  }
  try {
    if (options.path) saveConfigFile(next, options.path); else saveProviders(next, env);
  } catch {
    if (validated.apiKey && getApiKey(provider.name, env) === validated.apiKey) {
      try { if (previousKey === undefined) removeApiKey(provider.name, env); else setApiKey(provider.name, previousKey, env); }
      catch { throw new ProviderConnectionError("Saving failed and the API key could not be restored. Check auth.json before retrying."); }
    }
    throw new ProviderConnectionError("Cannot save provider configuration. Check the configuration path and retry.");
  }
  const { apiKey: _key, ...publicProvider } = provider; void _key;
  return { config: next, provider: publicProvider };
}
