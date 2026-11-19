import {
  getApiKey,
  getKeyCredential,
  removeApiKey,
  setApiKey,
  verifyAuthStoreIntegrity,
} from "./auth.ts";
import { saveConfigFile, saveProviders, type ProviderDefinition, type RingkoConfig } from "./config.ts";
import { parseApiKeysInput, selectNextApiKey, splitStoredApiKeys } from "./key-roulette.ts";
import { OAUTH_DOMAIN_BY_TYPE, PROVIDER_PRESETS, type ProviderPreset } from "./presets.ts";
import { isRecord } from "./util.ts";

export const PROVIDER_CONNECT_LIMITS = { name: 128, url: 4096, key: 16384, model: 1024, models: 500 } as const;
export interface ProviderConnectionInput { name: string; type: string; baseURL?: string; apiKey?: string; modelIds?: string[] }
export class ProviderConnectionError extends Error {}
const API_TYPES = new Set(PROVIDER_PRESETS.filter(preset => preset.auth === "apikey").map(preset => preset.type));
const LOCAL_NO_KEY_IDS = new Set(["ollama", "lmstudio", "vllm", "llama-cpp", "jan"]);

export interface ProviderCredentialStatus {
  configured: boolean;
  source: "auth" | "inline" | "env" | "local" | "oauth" | "none";
  keyCount: number;
  envVar?: string;
  envDetected: boolean;
}

export function matchPresetForProvider(provider: Pick<ProviderDefinition, "name" | "presetId" | "type" | "vendor" | "baseURL">): ProviderPreset | undefined {
  if (provider.presetId) {
    const byPresetId = PROVIDER_PRESETS.find(entry => entry.id === provider.presetId);
    if (byPresetId) return byPresetId;
  }
  const type = provider.type ?? provider.vendor;
  return PROVIDER_PRESETS.find(
    entry =>
      entry.auth === "apikey" &&
      entry.type === type &&
      (entry.id === provider.name ||
        type !== "openai-compatible" ||
        (provider.baseURL !== undefined &&
          entry.baseURL?.replace(/\/+$/, "") === provider.baseURL.replace(/\/+$/, ""))),
  );
}

/** Resolve the full API key pool for a provider (explicit > auth.json > preset env var). */
export function resolveProviderApiKeys(
  provider: ProviderDefinition,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (typeof provider.apiKey === "string" && provider.apiKey.length > 0) {
    const inlineKeys = splitStoredApiKeys(provider.apiKey);
    return inlineKeys.length > 0 ? inlineKeys : [provider.apiKey];
  }
  const storedEntry = getKeyCredential(provider.name, env);
  if (storedEntry) {
    return storedEntry.keys && storedEntry.keys.length > 0 ? [...storedEntry.keys] : [storedEntry.key];
  }
  const preset = matchPresetForProvider(provider);
  const rawEnv = preset?.apiKeyEnv ? env[preset.apiKeyEnv] : undefined;
  if (typeof rawEnv === "string" && rawEnv.length > 0) {
    const envKeys = splitStoredApiKeys(rawEnv);
    return envKeys.length > 0 ? envKeys : [rawEnv];
  }
  return [];
}

/**
 * Explicit and stored credentials win; preset environment variables stay out of files.
 * Multi-key pools rotate automatically via LRU (`KeyRoulette`).
 */
export function resolveProviderApiKey(
  provider: ProviderDefinition,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const pool = resolveProviderApiKeys(provider, env);
  return selectNextApiKey(provider.name, pool);
}

/** Inspect non-sensitive credential readiness for UI display without exposing key material. */
export function inspectProviderCredential(
  provider: Pick<ProviderDefinition, "name" | "presetId" | "type" | "vendor" | "baseURL" | "apiKey">,
  env: NodeJS.ProcessEnv = process.env,
): ProviderCredentialStatus {
  const rawType = provider.type ?? provider.vendor ?? "";
  if (rawType in OAUTH_DOMAIN_BY_TYPE || rawType === "anthropic-oauth") {
    return { configured: true, source: "oauth", keyCount: 0, envDetected: false };
  }
  const preset = matchPresetForProvider(provider);
  const envVar = preset?.apiKeyEnv;
  const rawEnv = envVar ? env[envVar] : undefined;
  const envKeys = typeof rawEnv === "string" && rawEnv.trim().length > 0 ? splitStoredApiKeys(rawEnv) : [];
  const envDetected = Boolean(rawEnv && rawEnv.trim().length > 0);

  if (typeof provider.apiKey === "string" && provider.apiKey.trim().length > 0) {
    const inlineKeys = splitStoredApiKeys(provider.apiKey);
    return {
      configured: true,
      source: "inline",
      keyCount: Math.max(1, inlineKeys.length),
      ...(envVar ? { envVar } : {}),
      envDetected,
    };
  }

  const stored = getKeyCredential(provider.name, env);
  if (stored) {
    const count = stored.keys && stored.keys.length > 0 ? stored.keys.length : 1;
    return {
      configured: true,
      source: "auth",
      keyCount: count,
      ...(envVar ? { envVar } : {}),
      envDetected,
    };
  }

  if (envDetected) {
    return {
      configured: true,
      source: "env",
      keyCount: Math.max(1, envKeys.length),
      ...(envVar ? { envVar } : {}),
      envDetected: true,
    };
  }

  if (LOCAL_NO_KEY_IDS.has(preset?.id ?? provider.name)) {
    return { configured: true, source: "local", keyCount: 0, envDetected: false };
  }

  return {
    configured: false,
    source: "none",
    keyCount: 0,
    ...(envVar ? { envVar } : {}),
    envDetected: false,
  };
}

export function validateProviderConnectionCredentials(provider: ProviderDefinition, env: NodeJS.ProcessEnv = process.env): void {
  const preset = PROVIDER_PRESETS.find(entry => entry.type === provider.type && entry.apiKeyPolicy && (entry.type !== "openai-compatible" || entry.id === provider.name || entry.baseURL === provider.baseURL));
  if (!preset?.apiKeyPolicy) return;
  const keys = resolveProviderApiKeys(provider, env);
  if (
    (preset.apiKeyPolicy.required && keys.length === 0) ||
    (keys.length > 0 && preset.apiKeyPolicy.asciiOnly && keys.some(key => /[^\x21-\x7e]/.test(key)))
  ) {
    throw new ProviderConnectionError(`Enter a valid ${preset.label} API key, save one in auth storage${preset.apiKeyEnv ? `, or set ${preset.apiKeyEnv}` : ""}.`);
  }
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
    if (typeof value.apiKey !== "string" || value.apiKey.length > PROVIDER_CONNECT_LIMITS.key) {
      throw new ProviderConnectionError("API key must contain visible ASCII characters without spaces.");
    }
    let parsedKeys: string[];
    try {
      parsedKeys = parseApiKeysInput(value.apiKey);
    } catch (error) {
      throw new ProviderConnectionError(error instanceof Error ? error.message : "API key must contain visible ASCII characters without spaces.");
    }
    if (parsedKeys.length === 0) throw new ProviderConnectionError("API key must contain visible ASCII characters without spaces.");
    result.apiKey = parsedKeys.join(",");
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

  const previousEntry = getKeyCredential(provider.name, env);
  if (validated.apiKey) {
    try {
      verifyAuthStoreIntegrity(env);
    } catch {
      throw new ProviderConnectionError("Cannot read the credential store. Repair auth.json before connecting.");
    }
    try {
      setApiKey(provider.name, validated.apiKey, env, {
        providerName: provider.name,
        providerType: provider.type ?? "openai-compatible",
      });
    } catch {
      throw new ProviderConnectionError("Cannot save the API key. Check credential storage and retry.");
    }
  }
  try {
    if (options.path) saveConfigFile(next, options.path); else saveProviders(next, env);
  } catch {
    const newPrimary = validated.apiKey?.split(",")[0];
    if (validated.apiKey && getApiKey(provider.name, env) === newPrimary) {
      try {
        if (!previousEntry) removeApiKey(provider.name, env);
        else {
          setApiKey(provider.name, previousEntry.keys ?? [previousEntry.key], env, {
            providerName: previousEntry.providerName,
            providerType: previousEntry.providerType,
          });
        }
      } catch {
        throw new ProviderConnectionError("Saving failed and the API key could not be restored. Check auth.json before retrying.");
      }
    }
    throw new ProviderConnectionError("Cannot save provider configuration. Check the configuration path and retry.");
  }
  const { apiKey: _key, ...publicProvider } = provider; void _key;
  return { config: next, provider: publicProvider };
}
