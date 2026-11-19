import type { RingkoConfig } from "./config.ts";
/** IDs are resolved only against enabled host configuration; never accept model-supplied endpoints. */
export function configuredModelIds(config: RingkoConfig): string[] {
  return [
    ...new Set(
      (config.providers ?? [])
        .filter(provider => provider.enabled !== false)
        .flatMap(provider => (provider.models ?? []).map(model => `${provider.name}/${model.id}`)),
    ),
  ];
}
