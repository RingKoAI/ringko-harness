// Runtime configuration for the ringko CLI.
//
// Providers are not compiled into the binary: the config names a provider
// module that is imported at run time (see provider.ts). The config file is
// `ringko.config.json` in the working directory unless `--config` overrides it.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ProviderConfig {
  /** Module to import at run time. Defaults to "@ringko-ai/providers". */
  module?: string;
  /** Provider kind, e.g. "openai", "anthropic", or "openai-compatible". */
  name?: string;
  /** Model id, e.g. "gpt-4o-mini" or "fktx/deepseek-v4-pro". */
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

export const DEFAULT_CONFIG_FILE = "ringko.config.json";

export function defaultConfigPath(cwd: string = process.cwd()): string {
  return resolve(cwd, DEFAULT_CONFIG_FILE);
}

/**
 * Load the config. A missing default file yields `{}`; a missing explicit file
 * is an error. The result is validated well enough to fail closed on bad input.
 */
export function loadConfig(path?: string, cwd: string = process.cwd()): RingkoConfig {
  const target = path ? resolve(cwd, path) : defaultConfigPath(cwd);
  let text: string;
  try {
    text = readFileSync(target, "utf8");
  } catch {
    if (path) throw new Error(`Cannot read config "${target}".`);
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
