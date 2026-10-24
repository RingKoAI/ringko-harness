import { Box, Text } from "ink";
import { useLayoutEffect, useMemo, useRef } from "react";
import stringWidth from "string-width";
import type { ReplItem } from "../state.ts";
import { createTranscriptRenderer } from "../transcript-layout.ts";
import { transcriptViewport, type TranscriptViewport } from "../transcript-viewport.ts";
import { fitTerminalLine } from "../editor.ts";
import { hintLine } from "../chrome.ts";
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
  viewKey?: string;
}

export function Transcript({ items, limit, expandThinking = false, expandTools = false, columns = 80, rows = 20, offset = 0, onOffset, viewKey = "main" }: TranscriptProps) {
  const render = useMemo(() => createTranscriptRenderer(), [viewKey]);
  const lines = useMemo(() => render(limit === undefined ? items : items.slice(-limit), columns, expandThinking, expandTools), [items, limit, expandThinking, expandTools, columns, render]);
  const tools = items.some(item => item.kind === "tool");
  const previous = useRef<TranscriptViewport | undefined>(undefined);
  const height = Math.max(0, rows - (tools && rows > 2 ? 1 : 0));
  const viewport = transcriptViewport(lines, height, columns, offset, viewKey, previous.current);
  useLayoutEffect(() => {
    previous.current = viewport;
    if (offset !== viewport.offset) onOffset?.(viewport.offset);
  });
  return <Box flexDirection="column" flexShrink={0}>
    {viewport.offset > 0 && height > 0 ? <Text color={viewport.pending ? theme.brand : theme.dim}>{fitTerminalLine(`${viewport.pending ? "New output · " : ""}History · PgDn to latest`, columns)}</Text> : null}
    {viewport.page.map((line, index) => <Text key={index} bold={line.heading} backgroundColor={line.kind === "user" ? theme.userBackground : undefined}
      color={line.failed ? theme.error : line.kind === "user" ? theme.userText : line.kind === "thinking" || line.kind === "notice" ? theme.dim : line.running && line.heading ? theme.brand : line.kind === "tool" && line.heading ? theme.tool : undefined}>{line.kind === "user" ? line.text + " ".repeat(Math.max(0, columns - stringWidth(line.text))) : line.text || " "}</Text>)}
    {tools && rows > 2 ? <Text color={theme.dim}>{hintLine([`Ctrl+O ${expandTools ? "collapse" : "expand"} tool details`, "Ctrl+T thinking"], columns)}</Text> : null}
  </Box>;
}
