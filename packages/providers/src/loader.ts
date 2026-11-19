// Runtime provider loading.
//
// `provider.json` defines providers (protocol type, base URL, models) and the
// last-used model. The core binary ships only the offline `echo` provider;
// hosted providers are built by importing the configured module at run time
// (kept external to the binary).
import * as bundledProviders from "@ringko-ai/providers";
import { canonicalProviderType } from "./registry.ts";
import { createEchoProvider } from "./echo.ts";
import type { ModelClient } from "@ringko-ai/harness";
import {
  resolveProviderApiKey,
  resolveProviderApiKeys,
  selectNextApiKey,
  modelLabel,
  selectModel,
  type ModelSelection,
  type RingkoConfig,
  type SelectionOverride,
} from "@ringko-ai/config";

export const DEFAULT_PROVIDER_MODULE = "@ringko-ai/providers";

export type ProviderImporter = (specifier: string) => Promise<Record<string, unknown>>;

const bundledModule = bundledProviders as unknown as Record<string, unknown>;

export interface ProviderFactoryOptions {
  provider: string;
  model?: string;
  name?: string;
  baseURL?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
  thinking?: string;
  /** Per-level override of the value sent for a thinking level. */
  reasoningEfforts?: Record<string, string>;
  cacheKey?: string;
}

export type ProviderFactory = (options: ProviderFactoryOptions) => ModelClient;

// The default provider module ships inside the binary; only custom modules are
// imported at run time.
const defaultImporter: ProviderImporter = (specifier) =>
  specifier === DEFAULT_PROVIDER_MODULE
    ? Promise.resolve(bundledModule)
    : (import(specifier) as Promise<Record<string, unknown>>);

export { createEchoProvider } from "./echo.ts";

/** Strip the chat-completions path so a full model URL becomes a base URL. */
export function baseUrlFromChatUrl(url: string): string {
  return url.replace(/\/chat\/completions\/?$/, "").replace(/\/completions\/?$/, "");
}

/** Resolve the selected provider+model into the options a provider module expects. */
export function resolveProviderConfig(selection: ModelSelection | undefined): ProviderFactoryOptions {
  if (!selection) return { provider: "echo" };
  const { provider, model } = selection;
  const rawType = (provider.type ?? provider.vendor ?? "").toLowerCase();
  const type = rawType.length > 0 ? canonicalProviderType(rawType) : "echo";
  const baseURL =
    provider.baseURL ??
    (model.url ? baseUrlFromChatUrl(model.url) : provider.url ? baseUrlFromChatUrl(provider.url) : undefined);
  return {
    provider: type,
    model: model.id,
    cacheKey: `${type}:${model.id}`,
    name: provider.name,
    baseURL,
    // Credentials live in auth.json; provider.json may still carry a key.
    apiKey: resolveProviderApiKey(provider),
    maxOutputTokens: model.maxOutputTokens,
    ...(model.reasoningEfforts ? { reasoningEfforts: model.reasoningEfforts } : {}),
  };
}

/**
 * Resolve the configured selection into a model client. Returns a string error
 * message (instead of throwing) so the CLI can report it and fail closed.
 */
export async function loadProviderModel(
  config: RingkoConfig,
  override: SelectionOverride = {},
  importer: ProviderImporter = defaultImporter,
): Promise<ModelClient | string> {
  if (override.provider && !(config.providers ?? []).some((entry) => entry.name === override.provider)) {
    return `Unknown provider "${override.provider}".`;
  }
  const selection = selectModel(config, override);
  const options = resolveProviderConfig(selection);
  if (config.thinking) options.thinking = config.thinking;
  if (options.provider === "echo") {
    return createEchoProvider();
  }

  const specifier = selection?.provider.module ?? DEFAULT_PROVIDER_MODULE;
  let module: Record<string, unknown>;
  try {
    module = await importer(specifier);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `Cannot load provider module "${specifier}": ${detail}`;
  }

  const factory = module.createProviderClient ?? module.default;
  if (typeof factory !== "function") {
    return `Provider module "${specifier}" does not export a createProviderClient factory.`;
  }

  try {
    const keyPool = selection ? resolveProviderApiKeys(selection.provider) : [];
    if (selection && keyPool.length > 1) {
      const providerName = selection.provider.name;
      return async (request) => {
        const rotatedKey = selectNextApiKey(providerName, keyPool) ?? options.apiKey;
        const client = (factory as ProviderFactory)({
          ...options,
          apiKey: rotatedKey,
          cacheKey: undefined,
        });
        return await client(request);
      };
    }
    return (factory as ProviderFactory)(options);
  } catch (error) {
    return error instanceof Error ? error.message : "Provider factory failed.";
  }
}

export interface DiscoverModelsInput {
  type: string;
  baseURL?: string;
  apiKey?: string;
  providerId?: string;
}

export interface DiscoveredModel {
  id: string;
  name?: string;
}

/**
 * Discover a provider's models via the (external) provider module. Returns a
 * string error instead of throwing so the CLI can report it and fail closed.
 */
export async function discoverProviderModels(
  input: DiscoverModelsInput,
  importer: ProviderImporter = defaultImporter,
): Promise<DiscoveredModel[] | string> {
  let module: Record<string, unknown>;
  try {
    module = await importer(DEFAULT_PROVIDER_MODULE);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `Cannot load provider module "${DEFAULT_PROVIDER_MODULE}": ${detail}`;
  }
  const factory = module.discoverModels;
  if (typeof factory !== "function") {
    return `Provider module "${DEFAULT_PROVIDER_MODULE}" does not export discoverModels.`;
  }
  try {
    return await (factory as (input: DiscoverModelsInput) => Promise<DiscoveredModel[]>)(input);
  } catch (error) {
    return error instanceof Error ? error.message : "Model discovery failed.";
  }
}

export { modelLabel };
