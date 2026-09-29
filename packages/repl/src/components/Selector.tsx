import { Box, Text, useInput, usePaste, useStdout } from "ink";
import { Fragment, useMemo, useState } from "react";
import { filterItems, type SelectorItem } from "../selection.ts";
import { cleanTerminalText, fitTerminalLine as truncate, graphemes } from "../editor.ts";
import { theme } from "../theme.ts";

export type { SelectorItem } from "../selection.ts";

export interface SelectorProps {
  title: string;
  items: readonly SelectorItem[];
  onSelect: (value: string) => void;
  onCancel: () => void;
}

export function Selector({ title, items, onSelect, onCancel }: SelectorProps) {
  const { stdout } = useStdout();
  const [query, setQuery] = useState("");
  const currentIndex = items.findIndex((item) => item.current);
  const [index, setIndex] = useState(currentIndex >= 0 ? currentIndex : 0);
  const filtered = useMemo(() => filterItems(items, query), [items, query]);
  const active = Math.min(index, Math.max(0, filtered.length - 1));
  const count = Math.max(1, Math.min(8, Math.floor(((stdout.rows ?? 24) - 14) / 2)));
  const start = Math.max(0, Math.min(active - Math.floor(count / 2), filtered.length - count));
  const visible = filtered.slice(start, start + count);
  const width = Math.max(10, (stdout.columns ?? 80) - 10);
  function search(input: string): void {
    setQuery(value => (value + cleanTerminalText(input.slice(0, 1024)).replace(/\n/g, " ")).slice(0, 256));
    setIndex(0);
  }
  usePaste(search);

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === "c")) { onCancel(); return; }
    if (key.upArrow || (key.ctrl && input === "p")) setIndex(Math.max(0, active - 1));
    else if (key.downArrow || (key.ctrl && input === "n")) setIndex(Math.min(filtered.length - 1, active + 1));
    else if (key.pageUp) setIndex(Math.max(0, active - count));
    else if (key.pageDown) setIndex(Math.min(filtered.length - 1, active + count));
    else if (key.return) { const selected = filtered[active]; if (selected) onSelect(selected.value); }
    else if (key.backspace || key.delete) { setQuery(value => graphemes(value).slice(0, -1).join("")); setIndex(0); }
    else if (key.ctrl && input === "u") { setQuery(""); setIndex(0); }
    else if (!key.ctrl && !key.meta && !key.tab && input) {
      search(input);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.brand} paddingX={1} flexShrink={0}>
      <Box justifyContent="space-between"><Text bold>{title}</Text><Text color={theme.dim}>{filtered.length} options</Text></Box>
      <Text color={query ? undefined : theme.dim}>{truncate(`Search: ${query || "type to filter"}`, width)}</Text>
      {visible.length === 0 ? <Text color={theme.dim}>No matches. Backspace to edit; Esc to return.</Text> : null}
      {visible.map((item, row) => {
        const selected = start + row === active;
        return <Fragment key={item.value}>
          {item.group && (row === 0 || visible[row - 1]?.group !== item.group) ? <Text bold color={theme.dim}>{truncate(cleanTerminalText(item.group), width)}</Text> : null}
          <Text color={selected ? theme.brand : undefined} backgroundColor={selected ? theme.userBackground : undefined} bold={selected}>
            {selected ? "> " : "  "}{truncate(cleanTerminalText(item.label), width - 12)}{item.current ? " [current]" : ""}
          </Text>
        </Fragment>;
      })}
      {filtered[active]?.description ? <Text color={theme.dim}>{truncate(cleanTerminalText(filtered[active].description ?? ""), width)}</Text> : null}
      <Text color={theme.dim}>{truncate(`${filtered.length ? `${active + 1}/${filtered.length} · ` : ""}Up/Down · Enter select · Esc back`, width)}</Text>
    </Box>
  );
}
