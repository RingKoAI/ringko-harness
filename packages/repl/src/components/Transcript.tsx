import { Box, Text } from "ink";
import { useEffect, useMemo } from "react";
import type { ReplItem } from "../state.ts";
import { transcriptLines } from "../transcript-layout.ts";
import { theme } from "../theme.ts";

export interface TranscriptProps {
  items: readonly ReplItem[];
  limit?: number;
  expandThinking?: boolean;
  expandTools?: boolean;
  columns?: number;
  rows?: number;
  offset?: number;
  onOffset?: (offset: number) => void;
}

export function Transcript({ items, limit, expandThinking = false, expandTools = false, columns = 80, rows = 20, offset = 0, onOffset }: TranscriptProps) {
  const lines = useMemo(() => transcriptLines(limit === undefined ? items : items.slice(-limit), columns, expandThinking, expandTools), [items, limit, expandThinking, expandTools, columns]);
  const height = Math.max(0, rows);
  const contentHeight = Math.max(0, height - (offset > 0 ? 1 : 0));
  const maximum = Math.max(0, lines.length - contentHeight);
  const active = Math.min(offset, maximum);
  useEffect(() => { if (offset !== active) onOffset?.(active); }, [offset, active, onOffset]);
  const end = Math.max(0, lines.length - active);
  const page = lines.slice(Math.max(0, end - contentHeight), end);
  return <Box flexDirection="column" flexShrink={0}>
    {active > 0 && height > 0 ? <Text color={theme.dim}>History · {active} rows above latest · PgDn to return</Text> : null}
    {page.map((line, index) => <Text key={index} bold={line.heading} backgroundColor={line.kind === "user" ? theme.userBackground : undefined}
      color={line.failed ? theme.error : line.kind === "thinking" || line.kind === "notice" ? theme.dim : line.kind === "tool" && line.heading ? theme.tool : undefined}>{line.text || " "}</Text>)}
  </Box>;
}
