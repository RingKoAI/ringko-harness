import { Box, Text, useStdout } from "ink";
import type { ReactNode } from "react";
import { fitTerminalLine } from "../editor.ts";
import { theme } from "../theme.ts";
import { terminalColumns } from "../terminal-layout.ts";

/** Shared, bottom-anchored command pane; nested contents do not draw another frame. */
export function Panel({ title, children, color = theme.brand }: {
  title: string;
  children: ReactNode;
  color?: string;
}) {
  const { stdout } = useStdout();
  const columns = terminalColumns(stdout.columns ?? 80);
  const width = Math.max(1, columns - 2);
  return <Box flexDirection="column" flexShrink={0}>
    <Text color={color}>{"─".repeat(columns)}</Text>
    <Box flexDirection="column" paddingX={columns > 2 ? 1 : 0}>
      <Text bold color={color}>{fitTerminalLine(title, width)}</Text>
      {children}
    </Box>
  </Box>;
}
