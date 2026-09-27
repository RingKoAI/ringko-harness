// Runtime configuration for the ringko CLI.
//
// Providers are not compiled into the binary: the config names a provider
// module that is imported at run time (see provider.ts). Configuration lives in
// the user's home directory, `~/.ringko/config`, so keys never sit in a project
// tree. `RINGKO_HOME` overrides the home directory (used by tests); `--config`
// overrides the file.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

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
}

export const CONFIG_DIR_NAME = ".ringko";
export const CONFIG_FILE_NAME = "config";

/** The RingKo home directory (`RINGKO_HOME` or the OS home). */
export function ringkoHome(): string {
  return process.env.RINGKO_HOME || homedir();
}

export function configDir(home: string = ringkoHome()): string {
  return join(home, CONFIG_DIR_NAME);
}

/** The default config file: `~/.ringko/config`. */
export function defaultConfigPath(home: string = ringkoHome()): string {
  return join(configDir(home), CONFIG_FILE_NAME);
}

export interface LoadConfigOptions {
  /** Explicit config file; a missing one is an error. */
  path?: string;
  /** Home directory override (tests); defaults to `RINGKO_HOME`/OS home. */
  home?: string;
  /** Base directory for a relative `path`. */
  cwd?: string;
}

/**
 * Load the config. A missing default file yields `{}`; a missing explicit file
 * is an error. The result is validated well enough to fail closed on bad input.
 */
export function loadConfig(options: LoadConfigOptions = {}): RingkoConfig {
  const target = options.path
    ? resolve(options.cwd ?? process.cwd(), options.path)
    : defaultConfigPath(options.home);

  let text: string;
  try {
    text = readFileSync(target, "utf8");
  } catch {
    if (options.path) throw new Error(`Cannot read config "${target}".`);
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Config "${target}" is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Config "${target}" must be a JSON object.`);
  }
  return parsed as RingkoConfig;
}

/** Write the config to `~/.ringko/config` (0600 on POSIX). Returns the path. */
export function saveConfig(config: RingkoConfig, home: string = ringkoHome()): string {
  const dir = configDir(home);
  mkdirSync(dir, { recursive: true });
  const target = defaultConfigPath(home);
  writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);
  try {
    chmodSync(target, 0o600);
  } catch {
    // best effort (e.g. Windows)
  }
  return target;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Read a dotted key, e.g. "provider.model". */
export function getConfigValue(config: RingkoConfig, dotted: string): unknown {
  let node: unknown = config;
  for (const key of dotted.split(".")) {
    const record = asRecord(node);
    if (!record) return undefined;
    node = record[key];
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
    if (!asRecord(node[key])) node[key] = {};
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
    const child = asRecord(node[keys[i]]);
    if (!child) return config;
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
