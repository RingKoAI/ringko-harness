import type { ModelSelection } from "./config.ts";
import { resolveModelContext, type ContextLimits } from "./context.ts";
import { ModelCatalogCache, modelCatalogUrl } from "./model-cache.ts";
import { isLocalModelHost } from "./network-address.ts";
import { ringkoRoot } from "./paths.ts";

const DEFAULT_CATALOG_CACHE_LIMIT = 8;
// Standalone CLI/embedded hosts own these process-lifetime caches. Backend hosts
// pass an instance they dispose on shutdown; eviction disposes standalone fetches.
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
    try { if (isLocalModelHost(new URL(url).hostname)) return false; }
    catch { return false; }
  }
  return true;
}

/** Backend, CLI and embedded hosts share capacity resolution without rebuilding model clients. */
export async function resolveSelectionContext(selection: ModelSelection | undefined, catalog?: ModelCatalogCache): Promise<ContextLimits> {
  if (!selection) return resolveModelContext({ id: "echo", name: "Echo" });
  const metadata = catalogEligible(selection) ? await (catalog ?? defaultCatalog()).find(selection.provider, selection.model) : undefined;
  return resolveModelContext(selection.model, metadata);
}
