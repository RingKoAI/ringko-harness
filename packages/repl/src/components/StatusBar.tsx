import { Box, Text } from "ink";
import { homedir } from "node:os";
import { relative, isAbsolute } from "node:path";
import { cleanTerminalText } from "../editor.ts";
import { truncate } from "../state.ts";
import { theme } from "../theme.ts";

export interface StatusBarProps {
  modelLabel: string;
  workspace: string;
  title?: string;
  columns?: number;
}

/** Collapse the home directory to `~` (like the pi footer). */
function formatCwd(path: string): string {
  const home = homedir();
  const child = relative(home, path);
  if (home.length > 0 && !isAbsolute(child) && child !== ".." && !child.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) return child ? `~/${child}` : "~";
  return path;
}

const HINTS = "Ctrl+L models · Ctrl+O tools · /shortcuts";

export function StatusBar({ modelLabel, workspace, title, columns = 80 }: StatusBarProps) {
  const line1 = title ? `${formatCwd(workspace)} • ${title}` : formatCwd(workspace);
  return (
    <Box flexDirection="column">
      <Text color={theme.dim}>{truncate(cleanTerminalText(line1), Math.max(1, columns))}</Text>
      <Text color={theme.dim}>{truncate(cleanTerminalText(modelLabel), Math.max(1, columns))}</Text>
      {columns >= 60 ? <Text color={theme.dim}>{HINTS}</Text> : null}
    </Box>
  );
}
