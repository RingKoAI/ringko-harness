import type { LanguageModel } from "ai";
import type { ModelClient } from "@ringko-ai/harness";
import type { AiSdkModelOptions } from "./ai-sdk.ts";
import type { DiscoveredModel, DiscoverModelsInput, DiscoverModelsOptions } from "./discovery.ts";

export interface ProviderClientOptions extends AiSdkModelOptions {
  provider: string;
  model: string;
  name?: string;
  baseURL?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  accountId?: string;
}

export interface ProviderAdapter {
  aliases?: readonly string[];
  resolveModel(options: ProviderClientOptions): LanguageModel;
  createClient?(options: ProviderClientOptions): ModelClient;
  discoverModels?(input: DiscoverModelsInput, options: DiscoverModelsOptions): Promise<DiscoveredModel[] | undefined>;
  forceStream?: boolean;
  discoveryFallbackMessage?: string;
}
