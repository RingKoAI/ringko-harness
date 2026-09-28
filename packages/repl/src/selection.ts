import type { RingkoConfig } from "@ringko-ai/config";

export interface SelectorItem {
  label: string;
  value: string;
  current?: boolean;
  group?: string;
  description?: string;
}
export function filterItems(items: readonly SelectorItem[], query: string): SelectorItem[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(item => words.every(word =>
    `${item.group ?? ""} ${item.label} ${item.value} ${item.description ?? ""}`.toLowerCase().includes(word)));
}
export function modelItems(config: RingkoConfig, current: string): SelectorItem[] {
  return [...(config.providers ?? [])].sort((a, b) => a.name.localeCompare(b.name)).flatMap(provider =>
    (provider.models ?? []).map(model => ({
      group: provider.name, label: model.name || model.id, description: model.id,
      value: `${provider.name}/${model.id}`, current: `${provider.name}/${model.id}` === current,
    })));
}
export function nextModel(items: readonly SelectorItem[], current: string, direction: 1 | -1): string | undefined {
  if (items.length === 0) return undefined;
  const index = items.findIndex(item => item.value === current);
  return items[index < 0 ? (direction === 1 ? 0 : items.length - 1) : (index + direction + items.length) % items.length]?.value;
}
