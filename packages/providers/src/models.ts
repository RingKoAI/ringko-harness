import { applyProxyEnv, knownModels, writeDiagnostic } from "@ringko-ai/config";
import { getProviderAdapter } from "./registry.ts";
import type { DiscoveredModel, DiscoverModelsInput, DiscoverModelsOptions } from "./discovery.ts";

export { normalizeModels, MODEL_DISCOVERY_TIMEOUT_MS } from "./discovery.ts";
export type { DiscoveredModel, DiscoverModelsOptions } from "./discovery.ts";
export { codexModelsRequest } from "./openai-oauth.ts";
export { COPILOT_MODELS_URL } from "./github-copilot.ts";

/** Shared fallback policy; each provider owns its discovery request and credentials. */
export async function discoverModels(input: DiscoverModelsInput, options: DiscoverModelsOptions = {}): Promise<DiscoveredModel[]> {
  applyProxyEnv();
  const adapter = getProviderAdapter(input.type);
  if (!adapter?.discoverModels) return knownModels(input.type);
  try { return await adapter.discoverModels(input, options) ?? knownModels(input.type); }
  catch (error) {
    if (options.strict === true) throw error;
    if (adapter.discoveryFallbackMessage) writeDiagnostic("provider.models", adapter.discoveryFallbackMessage);
    return knownModels(input.type);
  }
}
