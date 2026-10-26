import { resolveSelectionContext, selectModel, type ModelCatalogCache, type ContextLimits, type ModelSelection, type RingkoConfig } from "@ringko-ai/config";
import { loadProviderModel } from "@ringko-ai/providers/loader";
import type { ModelClient } from "@ringko-ai/sdk";

export interface LoadedModel { client: ModelClient; selection: ModelSelection; limits: ContextLimits }

/** Backend and CLI resolve modules/OAuth/echo identically. Provider configuration is trusted host input. */
export async function loadModel(config: RingkoConfig, catalog?: ModelCatalogCache): Promise<LoadedModel | string> {
  const selection = selectModel(config);
  const client = await loadProviderModel(config);
  if (typeof client === "string") return client;
  const resolved = selection ?? { provider: { name: "echo", type: "echo" }, model: { id: "echo", name: "Echo" } };
  const limits = await resolveSelectionContext(resolved, catalog);
  return { client, selection: resolved, limits };
}
