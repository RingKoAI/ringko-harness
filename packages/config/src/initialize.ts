import { defaultProviderFile, defaultSettings } from "./defaults.ts";
import { loadConfig } from "./config.ts";
import { assertConfigTarget, createJsonIfMissing } from "./json-file.ts";
import { providerPath, settingsPath } from "./paths.ts";

export interface InitializeConfigOptions { path?: string; env?: NodeJS.ProcessEnv }

/** Explicit configuration is caller-owned; user defaults are only created when absent. */
export function initializeConfig(options: InitializeConfigOptions = {}): string[] {
  if (options.path !== undefined) {
    if (typeof options.path !== "string" || !options.path.trim() || options.path.includes("\0")) throw new TypeError("Explicit configuration path must be a non-empty filesystem path.");
    return [];
  }
  const env = options.env ?? process.env;
  const settings = settingsPath(env), providers = providerPath(env);
  assertConfigTarget(settings); assertConfigTarget(providers);
  loadConfig({ env });
  const created: string[] = [];
  if (createJsonIfMissing(settings, defaultSettings())) created.push(settings);
  if (createJsonIfMissing(providers, defaultProviderFile())) created.push(providers);
  return created;
}
