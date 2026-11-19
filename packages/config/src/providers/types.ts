export interface PresetStarterModel {
  id: string;
  name: string;
}

export interface ProviderPreset {
  /** Stable id, also used as the default configuration name. */
  id: string;
  label: string;
  /** Transport kind implemented by a runtime provider adapter. */
  type: string;
  /** Whether this preset belongs to the 15 always-visible built-in workbench providers. */
  builtin?: boolean;
  baseURL?: string;
  /** Canonical upstream base URL shown for endpoint preview / 1-click reset when `baseURL` is implicit. */
  defaultBaseURL?: string;
  apiKeyEnv?: string;
  /** Direct console URL where users create or copy their API key. */
  apiKeyUrl?: string;
  auth?: "apikey" | "oauth";
  docs?: string;
  /** Curated starter models seeded on 1-click activation so users do not have to sift through hundreds of IDs. */
  defaultModels?: readonly PresetStarterModel[];
  aliases?: readonly string[];
  apiKeyPolicy?: { required: boolean; asciiOnly?: boolean };
}
