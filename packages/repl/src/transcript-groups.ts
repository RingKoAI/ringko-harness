import type { ReplItem } from "./state.ts";

const EXPLORATION_TOOLS = new Set(["read", "glob", "grep", "list"]);
export interface TranscriptGroup { items: readonly ReplItem[]; exploration: boolean }

/** A presentation-only projection; original calls, results and their IDs stay intact. */
export function transcriptGroups(items: readonly ReplItem[]): TranscriptGroup[] {
  const groups: { items: ReplItem[]; exploration: boolean }[] = [];
  for (const item of items) {
    const exploration = item.kind === "tool" && !item.failed && !item.incomplete && EXPLORATION_TOOLS.has(item.toolName ?? "");
    const previous = groups.at(-1);
    if (exploration && previous?.exploration) previous.items.push(item);
    else groups.push({ items: [item], exploration });
  }
  return groups;
}

export function explorationLabel(items: readonly ReplItem[]): string {
  const reads = items.filter(item => item.toolName === "read").length;
  const searches = items.filter(item => item.toolName === "grep" || item.toolName === "glob").length;
  const lists = items.length - reads - searches;
  const counts = [[reads, "read"], [searches, "search"], [lists, "listing"]] as const;
  const detail = counts.filter(([count]) => count > 0).map(([count, name]) => `${count} ${name}${count === 1 ? "" : name === "search" ? "es" : "s"}`).join(" · ");
  return `${items.some(item => item.running) ? "Exploring" : "Explored"} · ${detail}`;
}
