export interface ProviderPreset {
  /** Stable id, also used as the default configuration name. */
  id: string;
  label: string;
  /** Transport kind implemented by a runtime provider adapter. */
  type: string;
  baseURL?: string;
  apiKeyEnv?: string;
  auth?: "apikey" | "oauth";
  docs?: string;
  aliases?: readonly string[];
  apiKeyPolicy?: { required: boolean; asciiOnly?: boolean };
}
