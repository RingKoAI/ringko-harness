import { selectModel, type ModelSelection, type RingkoConfig } from "@ringko-ai/config";
import { loadProviderModel } from "@ringko-ai/providers/loader";
import type { ModelClient } from "@ringko-ai/sdk";

export interface LoadedModel { client: ModelClient; selection: ModelSelection }

/** Backend and CLI resolve modules/OAuth/echo identically. Provider configuration is trusted host input. */
export async function loadModel(config: RingkoConfig): Promise<LoadedModel | string> {
  const selection = selectModel(config);
  const client = await loadProviderModel(config);
  if (typeof client === "string") return client;
  return { client, selection: selection ?? { provider: { name: "echo", type: "echo" }, model: { id: "echo", name: "Echo" } } };
}
