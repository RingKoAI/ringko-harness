import type { RingkoConfig } from "@ringko-ai/config";

export interface SelectorItem {
  label: string;
  value: string;
  current?: boolean;
  group?: string;
  description?: string;
  aliases?: readonly string[];
}
export function filterItems(items: readonly SelectorItem[], query: string, ranked = false): SelectorItem[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text = (item: SelectorItem) => `${item.group ?? ""} ${item.label} ${item.value} ${item.description ?? ""} ${(item.aliases ?? []).join(" ")}`.toLowerCase();
  if (!ranked || !words.length) return items.filter(item => words.every(word => text(item).includes(word)));
  const compact = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const needle = compact(query);
  return items.map((item, index) => {
    const names = [item.label, ...(item.aliases ?? []), item.value].map(compact);
    const score = needle && names.includes(needle) ? 0 : needle && names.some(name => name.startsWith(needle)) ? 1 : needle && words.every(word => names.some(name => name.includes(compact(word)))) ? 2 : words.every(word => text(item).includes(word)) ? 3 : undefined;
    return { item, index, score };
  }).filter((entry): entry is { item: SelectorItem; index: number; score: number } => entry.score !== undefined)
    .sort((a, b) => a.score - b.score || a.index - b.index).map(entry => entry.item);
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
