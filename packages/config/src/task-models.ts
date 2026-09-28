import type { RingkoConfig } from "./config.ts";
/** IDs are resolved only against host configuration; never accept model-supplied endpoints. */
export function configuredModelIds(config: RingkoConfig): string[] {
  return [...new Set((config.providers ?? []).flatMap(provider => (provider.models ?? []).map(model => `${provider.name}/${model.id}`)))];
}
