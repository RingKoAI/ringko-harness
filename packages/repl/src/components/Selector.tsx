import { Text, useInput, usePaste, useStdout, type Key } from "ink";
import { Fragment, useMemo, useRef, useState } from "react";
import { filterItems, type SelectorItem } from "../selection.ts";
import { cleanTerminalText, fitTerminalLine as truncate, graphemes } from "../editor.ts";
import { theme } from "../theme.ts";
import { Panel } from "./Panel.tsx";
import { hintLine } from "../chrome.ts";
import { terminalColumns } from "../terminal-layout.ts";

export type { SelectorItem } from "../selection.ts";

/** An inline action offered on the highlighted item (e.g. Ctrl+R rename). */
export interface SelectorAction {
  /** Short hint such as "Ctrl+R rename". */
  label: string;
  match(input: string, key: Key): boolean;
  trigger(item: SelectorItem): void;
}

export interface SelectorProps {
  title: string;
  items: readonly SelectorItem[];
  onSelect: (value: string) => void;
  onCancel: () => void;
  actions?: readonly SelectorAction[];
  rankedSearch?: boolean;
  searchHint?: string;
  selectHint?: string;
}

export function Selector({ title, items, onSelect, onCancel, actions, rankedSearch = false, searchHint = "type to filter", selectHint = "Enter select" }: SelectorProps) {
  const { stdout } = useStdout();
  const currentIndex = items.findIndex((item) => item.current);
  const [view, setView] = useState({ query: "", index: currentIndex >= 0 ? currentIndex : 0 });
  const navigation = useRef(view);
  const { query, index } = view;
  function move(patch: Partial<typeof view>): void { navigation.current = { ...navigation.current, ...patch }; setView(navigation.current); }
  const filtered = useMemo(() => filterItems(items, query, rankedSearch), [items, query, rankedSearch]);
  const active = Math.min(index, Math.max(0, filtered.length - 1));
  const count = Math.max(1, Math.min(rankedSearch ? 4 : 8, Math.floor(((stdout.rows ?? 24) - 14) / 2)));
  const start = Math.max(0, Math.min(active - Math.floor(count / 2), filtered.length - count));
  const visible = filtered.slice(start, start + count);
  const width = Math.max(1, terminalColumns(stdout.columns ?? 80) - 2);
  function search(input: string): void {
    move({ query: (navigation.current.query + cleanTerminalText(input.slice(0, 1024)).replace(/\s+/g, " ")).slice(0, 256), index: 0 });
  }
  usePaste(search);

  useInput((input, key) => {
    if (key.eventType === "release") return;
    const current = navigation.current;
    const matches = filterItems(items, current.query, rankedSearch);
    const cursor = Math.min(current.index, Math.max(0, matches.length - 1));
    if (key.escape || (key.ctrl && input === "c")) { onCancel(); return; }
    if (actions && !key.upArrow && !key.downArrow && !key.pageUp && !key.pageDown) {
      for (const action of actions) {
        if (!action.match(input, key)) continue;
        const selected = matches[cursor];
        if (selected) action.trigger(selected);
        return;
      }
    }
    if (key.upArrow || (key.ctrl && input === "p")) move({ index: Math.max(0, cursor - 1) });
    else if (key.downArrow || (key.ctrl && input === "n")) move({ index: Math.max(0, Math.min(matches.length - 1, cursor + 1)) });
    else if (key.pageUp) move({ index: Math.max(0, cursor - count) });
    else if (key.pageDown) move({ index: Math.max(0, Math.min(matches.length - 1, cursor + count)) });
    else if (key.return) { const selected = matches[cursor]; if (selected) onSelect(selected.value); }
    else if (key.backspace || key.delete) move({ query: graphemes(current.query).slice(0, -1).join(""), index: 0 });
    else if (key.ctrl && input === "u") move({ query: "", index: 0 });
    else if (!key.ctrl && !key.meta && !key.tab && input) {
      search(input);
    }
  });

  return (
    <Panel title={`${title} · ${filtered.length} options`}>
      <Text color={query ? undefined : theme.dim}>{truncate(`Search: ${query || searchHint}`, width)}</Text>
      {visible.length === 0 ? <Text color={theme.dim}>No matches. Backspace to edit; Esc to return.</Text> : null}
      {visible.map((item, row) => {
        const selected = start + row === active;
        return <Fragment key={item.value}>
          {item.group && (row === 0 || visible[row - 1]?.group !== item.group) ? <Text bold color={theme.dim}>{truncate(cleanTerminalText(item.group), width)}</Text> : null}
          <Text color={selected ? theme.brand : undefined} backgroundColor={selected ? theme.selected : undefined} bold={selected}>
            {selected ? "> " : "  "}{truncate(cleanTerminalText(item.label), width - 12)}{item.current ? " [current]" : ""}
          </Text>
        </Fragment>;
      })}
      {filtered[active]?.description ? <Text color={theme.dim}>{truncate(cleanTerminalText(filtered[active].description ?? ""), width)}</Text> : null}
      <Text color={theme.dim}>{hintLine([selectHint, "Esc back", ...(rankedSearch ? ["Type to search"] : ["↑/↓"]), ...(actions ?? []).map(action => action.label), ...(filtered.length ? [`${active + 1}/${filtered.length}`] : [])], width)}</Text>
    </Panel>
  );
}
