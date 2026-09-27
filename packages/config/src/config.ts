// RingKo configuration: provider definitions (`provider.json`) plus local
// settings (`settings.local.json`), both under `~/.ringko`.
//
// Providers and capabilities are resolved at run time; keys stay out of project
// trees, and the files are written 0600 on POSIX.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { providerPath, settingsPath } from "./paths.ts";

export interface ProviderConfig {
  /** Module to import at run time. Defaults to "@ringko-ai/providers". */
  module?: string;
  /** Provider kind, e.g. "openai", "anthropic", or "openai-compatible". */
  name?: string;
  /** Model id, e.g. "gpt-4o-mini" or "vendor/model". */
  model?: string;
  /** VS Code-style providers file (array of entries) to read providers from. */
  file?: string;
  /** Entry name to select inside `file`. */
  entry?: string;
  /** Vendor id (mapped to a provider kind), e.g. "customendpoint". */
  vendor?: string;
  /** OpenAI-compatible base URL, e.g. "https://host/v1". */
  baseURL?: string;
  /** Full chat-completions URL (converted to a base URL). */
  url?: string;
  apiKey?: string;
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface RingkoConfig {
  workspace?: string;
  provider?: ProviderConfig;
  capabilities?: {
    network?: boolean;
    shell?: boolean;
  };
  mode?: string;
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

const PROVIDER_KEYS = ["module", "name", "model", "file", "entry", "vendor", "baseURL", "url", "apiKey"];

function extractProvider(file: Record<string, unknown>): ProviderConfig | undefined {
  if (isRecord(file.provider)) return file.provider as ProviderConfig;
  if (PROVIDER_KEYS.some((key) => key in file)) return file as ProviderConfig;
  return undefined;
}

/** Load the merged configuration from `settings.local.json` and `provider.json`. */
export function loadConfig(options: LoadConfigOptions = {}): RingkoConfig {
  if (options.path) return readObject(options.path, true) as RingkoConfig;

  const settings = readObject(settingsPath(options.env), false) as RingkoConfig;
  const providerFile = readObject(providerPath(options.env), false);
  const provider = extractProvider(providerFile);
  return provider ? { ...settings, provider } : settings;
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

/** Persist the config, splitting providers into `provider.json` and the rest into `settings.local.json`. */
export function saveConfig(config: RingkoConfig, env: NodeJS.ProcessEnv = process.env): string[] {
  const { provider, ...settings } = config;
  return [
    writeJson(settingsPath(env), settings as Record<string, unknown>),
    writeJson(providerPath(env), provider ? { provider } : {}),
  ];
}

/** Read a dotted key, e.g. "provider.model". */
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

