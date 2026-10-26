import { ModelCatalogCache, modelCatalogUrl, resolveModelContext, ringkoRoot, selectModel, type ContextLimits, type ModelSelection, type RingkoConfig } from "@ringko-ai/config";
import { loadProviderModel } from "@ringko-ai/providers/loader";
import type { ModelClient } from "@ringko-ai/sdk";

export interface LoadedModel { client: ModelClient; selection: ModelSelection; limits: ContextLimits }

const DEFAULT_CATALOG_CACHE_LIMIT = 8;
const catalogs = new Map<string, ModelCatalogCache>();
function defaultCatalog(): ModelCatalogCache {
  const key = `${ringkoRoot()}\0${modelCatalogUrl()}`;
  let catalog = catalogs.get(key);
  if (!catalog) {
    if (catalogs.size >= DEFAULT_CATALOG_CACHE_LIMIT) {
      const oldest = catalogs.keys().next().value;
      if (oldest !== undefined) { catalogs.get(oldest)?.dispose(); catalogs.delete(oldest); }
    }
    catalog = new ModelCatalogCache();
    catalogs.set(key, catalog);
  }
  return catalog;
}

function catalogEligible(selection: ModelSelection): boolean {
  if (selection.model.catalogId) return true;
  const type = selection.provider.type ?? selection.provider.vendor;
  if (!type || type === "echo") return false;
  const url = selection.provider.baseURL ?? selection.model.url ?? selection.provider.url;
  if (url) {
    try {
      const host = new URL(url).hostname;
      if (host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || /^127\./.test(host)) return false;
    } catch { return false; }
  }
  return true;
}

/** Backend and CLI resolve modules/OAuth/echo identically. Provider configuration is trusted host input. */
export async function loadModel(config: RingkoConfig, catalog?: ModelCatalogCache): Promise<LoadedModel | string> {
  const selection = selectModel(config);
  const client = await loadProviderModel(config);
  if (typeof client === "string") return client;
  const resolved = selection ?? { provider: { name: "echo", type: "echo" }, model: { id: "echo", name: "Echo" } };
  const metadata = catalogEligible(resolved) ? await (catalog ?? defaultCatalog()).find(resolved.provider, resolved.model) : undefined;
  const limits = resolveModelContext(resolved.model, metadata);
  return { client, selection: resolved, limits };
}
