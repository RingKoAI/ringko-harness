import type { DiscoveredProviderModel } from '@/api'

/**
 * Merge a discovered model list into the configured one. Existing entries keep
 * their edited names; new ids are appended in discovery order.
 */
export function mergeDiscoveredModels<T extends { id: string; name?: string }>(
  existing: readonly T[],
  discovered: readonly DiscoveredProviderModel[],
): Array<T | { id: string; name: string }> {
  const seen = new Set(existing.map(model => model.id))
  const merged: Array<T | { id: string; name: string }> = existing.map(model => ({ ...model, name: model.name ?? '' }))
  for (const model of discovered) {
    if (!model.id || seen.has(model.id)) continue
    seen.add(model.id)
    merged.push({ id: model.id, name: model.name || model.id })
  }
  return merged
}

/** Count ids that a discovery pass would add. */
export function newModelCount(existing: readonly { id: string }[], discovered: readonly DiscoveredProviderModel[]): number {
  const seen = new Set(existing.map(model => model.id))
  let count = 0
  for (const model of discovered) {
    if (!model.id || seen.has(model.id)) continue
    seen.add(model.id)
    count += 1
  }
  return count
}
