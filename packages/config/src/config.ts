// RingKo configuration.
//
// `~/.ringko/provider.json` defines providers and the last-used model:
//   { "model": "<provider>/<model-id>", "small_model": "", "providers": [ ... ] }
// `~/.ringko/settings.local.json` holds workspace/capabilities/mode.
//
// Keys stay out of project trees; files are written 0600 on POSIX.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CatalogModel } from "./catalog.ts";
import { providerPath, settingsPath } from "./paths.ts";

/** One model offered by a provider. */
export interface ModelDefinition {
  /** Display name (TUI/WebUI). */
  name: string;
  /** Model id sent in requests. */
  id: string;
  thinking?: boolean;
  vision?: boolean;
  toolCalling?: boolean;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  /** Optional per-model chat-completions URL (base URL is derived from it). */
  url?: string;
}

/** One provider definition. */
export interface ProviderDefinition {
  /** Provider name (shown as `name/model.name`). */
  name: string;
  /** Protocol type: "openai-compatible", "openai", "anthropic", ... */
  type?: string;
  /** Alias of `type`. */
  vendor?: string;
  /** Gateway base URL, e.g. "https://host/v1". */
  baseURL?: string;
  /** Full chat-completions URL (converted to a base URL). */
  url?: string;
  apiKey?: string;
  /** Module to import at run time. Defaults to "@ringko-ai/providers". */
  module?: string;
  models?: ModelDefinition[];
}

export interface RingkoConfig {
  workspace?: string;
  capabilities?: {
    network?: boolean;
    shell?: boolean;
  };
  mode?: string;
  /** Reasoning/thinking depth: "off" | "low" | "high" | "max". */
  thinking?: string;
  /** Whether model reasoning is expanded in the UI (false = collapsed). */
  expandThinking?: boolean;
  /** Whether tool outputs/arguments are expanded in the UI (false = collapsed). */
  expandTools?: boolean;
  /** Automatic compaction settings. */
  compaction?: {
    enabled?: boolean;
    ratio?: number;
    keepRecent?: number;
    margin?: number;
  };
  /** Currently selected model, `"<providerName>/<modelId>"`. */
  model?: string;
  /** Optional cheaper model for helper tasks. */
  small_model?: string;
  providers?: ProviderDefinition[];
}

export interface ModelSelection {
  provider: ProviderDefinition;
  model: ModelDefinition;
}

export interface LoadConfigOptions {
  /** Explicit config file to read instead of the layered files. */
  path?: string;
  /** Environment (for `RINGKO_HOME`); defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readObject(path: string, required: boolean): Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    if (required) throw new Error(`Cannot read config "${path}".`);
    return {};
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) return {}; // empty placeholder file
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`Config "${path}" is not valid JSON: ${(error as Error).message}`);
  }
  if (!isRecord(parsed)) throw new Error(`Config "${path}" must be a JSON object.`);
  return parsed;
}

/** Load the merged configuration (settings + provider definitions + selection). */
export function loadConfig(options: LoadConfigOptions = {}): RingkoConfig {
  if (options.path) return readObject(options.path, true) as RingkoConfig;

  const settings = readObject(settingsPath(options.env), false) as RingkoConfig;
  const providerFile = readObject(providerPath(options.env), false);

  const merged: RingkoConfig = { ...settings };
  if (Array.isArray(providerFile.providers)) merged.providers = providerFile.providers as ProviderDefinition[];
  if (typeof providerFile.model === "string") merged.model = providerFile.model;
  if (typeof providerFile.small_model === "string") merged.small_model = providerFile.small_model;
  return merged;
}

function writeJson(path: string, value: Record<string, unknown>): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  try {
    chmodSync(path, 0o600);
  } catch {
    // best effort (e.g. Windows)
  }
  return path;
}

/** Persist the config: providers/selection to `provider.json`, the rest to `settings.local.json`. */
export function saveConfig(config: RingkoConfig, env: NodeJS.ProcessEnv = process.env): string[] {
  const { providers, model, small_model, ...settings } = config;
  return [
    writeJson(settingsPath(env), settings as Record<string, unknown>),
    writeJson(providerPath(env), {
      model: model ?? "",
      small_model: small_model ?? "",
      providers: providers ?? [],
    }),
  ];
}

/** The provider file contents (`~/.ringko/provider.json`). */
export interface ProviderFile {
  model?: string;
  small_model?: string;
  providers?: ProviderDefinition[];
}

/** Read `provider.json` alone (no settings merge). */
export function loadProviders(env: NodeJS.ProcessEnv = process.env): ProviderFile {
  const file = readObject(providerPath(env), false);
  const result: ProviderFile = {};
  if (Array.isArray(file.providers)) result.providers = file.providers as ProviderDefinition[];
  if (typeof file.model === "string") result.model = file.model;
  if (typeof file.small_model === "string") result.small_model = file.small_model;
  return result;
}

/** Write `provider.json` alone, leaving `settings.local.json` untouched. */
export function saveProviders(file: ProviderFile, env: NodeJS.ProcessEnv = process.env): string {
  return writeJson(providerPath(env), {
    model: file.model ?? "",
    small_model: file.small_model ?? "",
    providers: file.providers ?? [],
  });
}

/** Write `settings.local.json` alone, leaving `provider.json` untouched. */
export function saveSettings(config: RingkoConfig, env: NodeJS.ProcessEnv = process.env): string {
  const { providers, model, small_model, ...settings } = config;
  void providers;
  void model;
  void small_model;
  return writeJson(settingsPath(env), settings as Record<string, unknown>);
}

export interface SelectionOverride {
  provider?: string;
  model?: string;
}

/** Resolve the active provider+model from the selection (or the first available). */
export function selectModel(config: RingkoConfig, override: SelectionOverride = {}): ModelSelection | undefined {
  const providers = config.providers ?? [];
  if (providers.length === 0) return undefined;

  let providerName = override.provider;
  let modelId = override.model;
  if (!providerName) {
    const selected = config.model ?? "";
    const slash = selected.indexOf("/");
    if (slash > 0) {
      providerName = selected.slice(0, slash);
      modelId = modelId ?? selected.slice(slash + 1);
    }
  }

  const provider = (providerName ? providers.find((entry) => entry.name === providerName) : undefined) ?? providers[0];
  const models = provider.models ?? [];
  if (models.length === 0) return undefined;
  const model = (modelId ? models.find((entry) => entry.id === modelId) : undefined) ?? models[0];
  return { provider, model };
}

/**
 * Merge discovered/catalogued models into a provider (creating it when needed),
 * returning a new config. Existing models are kept; only new ids are appended.
 */
export function upsertProviderModels(
  config: RingkoConfig,
  providerName: string,
  type: string | undefined,
  models: readonly CatalogModel[],
): RingkoConfig {
  const clone = structuredClone(config);
  const providers = clone.providers ?? [];
  let provider = providers.find((entry) => entry.name === providerName);
  if (!provider) {
    provider = { name: providerName, models: [] };
    providers.push(provider);
  }
  if (type && !provider.type) provider.type = type;
  const existing = provider.models ?? [];
  const byId = new Map(existing.map((entry) => [entry.id, entry]));
  for (const model of models) {
    const current = byId.get(model.id);
    if (current) {
      if (!current.name && model.name) current.name = model.name;
      continue;
    }
    const created: ModelDefinition = { id: model.id, name: model.name ?? model.id };
    existing.push(created);
    byId.set(model.id, created);
  }
  provider.models = existing;
  if (!clone.model && existing.length > 0) clone.model = `${providerName}/${existing[0].id}`;
  clone.providers = providers;
  return clone;
}

/** Display label, `"<providerName>/<modelName>"` (or "echo"). */
export function modelLabel(selection: ModelSelection | undefined): string {
  return selection ? `${selection.provider.name}/${selection.model.name}` : "echo";
}

/** Read a dotted key, e.g. "model". */
export function getConfigValue(config: RingkoConfig, dotted: string): unknown {
  let node: unknown = config;
  for (const key of dotted.split(".")) {
    if (!isRecord(node)) return undefined;
    node = node[key];
  }
  return node;
}

/** Return a copy of the config with a dotted key set. */
export function setConfigValue(config: RingkoConfig, dotted: string, value: unknown): RingkoConfig {
  const keys = dotted.split(".");
  const clone = structuredClone(config) as Record<string, unknown>;
  let node = clone;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (!isRecord(node[key])) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  node[keys[keys.length - 1]] = value;
  return clone as RingkoConfig;
}

/** Return a copy of the config with a dotted key removed. */
export function unsetConfigValue(config: RingkoConfig, dotted: string): RingkoConfig {
  const keys = dotted.split(".");
  const clone = structuredClone(config) as Record<string, unknown>;
  let node = clone;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const child = node[keys[i]];
    if (!isRecord(child)) return config;
    node = child;
  }
  delete node[keys[keys.length - 1]];
  return clone as RingkoConfig;
}

/** Parse a CLI value: JSON when it parses, otherwise the raw string. */
export function parseConfigValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
