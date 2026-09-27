// Runtime provider loading.
//
// The core binary ships only the offline `echo` provider. Hosted providers are
// introduced through configuration: a config names a provider module that is
// imported at run time and called to build the model client. The module is
// imported dynamically (marked external at build time), so provider code and
// the AI SDK are never embedded in the ringko binary.
//
// A config may also point at a VS Code-style providers file (an array of
// { name, vendor, apiKey, models: [{ id, url }] } entries) so existing custom
// endpoints can be reused.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ModelClient } from "@ringko-ai/sdk";
import type { ProviderConfig } from "@ringko-ai/config";

export const DEFAULT_PROVIDER_MODULE = "@ringko-ai/providers";

export type ProviderImporter = (specifier: string) => Promise<Record<string, unknown>>;

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
}

export type ProviderFactory = (options: ProviderFactoryOptions) => ModelClient;

interface ProvidersFileEntry {
  name?: string;
  vendor?: string;
  apiKey?: string;
  apiType?: string;
  models?: Array<{ id?: string; name?: string; url?: string }>;
}

const defaultImporter: ProviderImporter = (specifier) =>
  import(specifier) as Promise<Record<string, unknown>>;

/** The vendor ids understood by the bundled providers module. */
const VENDOR_ALIASES: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  customendpoint: "openai-compatible",
  "openai-compatible": "openai-compatible",
};

/** Strip the chat-completions path so a full model URL becomes a base URL. */
export function baseUrlFromChatUrl(url: string): string {
  return url.replace(/\/chat\/completions\/?$/, "").replace(/\/completions\/?$/, "");
}

function readProvidersFile(path: string): ProvidersFileEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read providers file "${path}": ${(error as Error).message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Providers file "${path}" must be a JSON array.`);
  }
  return parsed as ProvidersFileEntry[];
}

/** Resolve the configured provider into the options a provider module expects. */
export function resolveProviderConfig(provider: ProviderConfig | undefined, cwd = process.cwd()): ProviderFactoryOptions {
  if (!provider) {
    return { provider: "echo" };
  }

  if (provider.file) {
    const file = resolve(cwd, provider.file);
    const selector = provider.entry ?? provider.name;
    const entries = readProvidersFile(file);
    const entry = entries.find((candidate) => candidate.name === selector);
    if (!entry) {
      throw new Error(`No provider named "${selector ?? ""}" in "${provider.file}".`);
    }
    const models = entry.models ?? [];
    const chosen = models.find((model) => model.id === provider.model) ?? models[0];
    const url = provider.url ?? chosen?.url;
    const vendor = (entry.vendor ?? "").toLowerCase();
    return {
      provider: provider.name ?? VENDOR_ALIASES[vendor] ?? vendor,
      model: provider.model ?? chosen?.id,
      name: entry.name,
      apiKey: provider.apiKey ?? entry.apiKey,
      baseURL: provider.baseURL ?? (url ? baseUrlFromChatUrl(url) : undefined),
      system: provider.system,
      temperature: provider.temperature,
      maxOutputTokens: provider.maxOutputTokens,
    };
  }

  const vendor = (provider.vendor ?? "").toLowerCase();
  return {
    provider: provider.name ?? VENDOR_ALIASES[vendor] ?? "echo",
    model: provider.model,
    name: provider.name,
    baseURL: provider.baseURL,
    apiKey: provider.apiKey,
    system: provider.system,
    temperature: provider.temperature,
    maxOutputTokens: provider.maxOutputTokens,
  };
}

/**
 * A deterministic, offline model provider. It echoes the last message so the
 * binary and the tool pipeline can be exercised without a provider module.
 */
export function createEchoProvider(): ModelClient {
  return async (request) => {
    const last = request.messages.at(-1)?.content ?? "";
    return { content: `echo: ${last}`, toolCalls: [] };
  };
}

/**
 * Resolve the configured provider into a model client. Returns a string error
 * message (instead of throwing) so the CLI can report it and fail closed.
 */
export async function loadProviderModel(
  provider: ProviderConfig | undefined,
  importer: ProviderImporter = defaultImporter,
  cwd = process.cwd(),
): Promise<ModelClient | string> {
  let options: ProviderFactoryOptions;
  try {
    options = resolveProviderConfig(provider, cwd);
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid provider configuration.";
  }

  if (options.provider === "echo") {
    return createEchoProvider();
  }

  const specifier = provider?.module ?? DEFAULT_PROVIDER_MODULE;
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
    return (factory as ProviderFactory)(options);
  } catch (error) {
    return error instanceof Error ? error.message : "Provider factory failed.";
  }
}
