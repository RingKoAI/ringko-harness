import { Box, Text } from "ink";
import { homedir } from "node:os";
import { relative, isAbsolute } from "node:path";
import stringWidth from "string-width";
import { fitTerminalLine } from "../editor.ts";
import { theme } from "../theme.ts";

export interface StatusBarProps {
  modelLabel: string;
  workspace: string;
  title?: string;
  columns?: number;
  compact?: boolean;
  /** Active self-referential loop status (iteration / promise). */
  loop?: string;
}

/** Collapse the home directory to `~` (like the pi footer). */
function formatCwd(path: string): string {
  const home = homedir();
  const child = relative(home, path);
  if (home.length > 0 && !isAbsolute(child) && child !== ".." && !child.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) return child ? `~/${child}` : "~";
  return path;
}

export function StatusBar({ modelLabel, workspace, title, columns = 80, compact = false, loop }: StatusBarProps) {
  const line1 = title ? `${formatCwd(workspace)} • ${title}` : formatCwd(workspace);
  const model = fitTerminalLine(modelLabel, Math.max(1, Math.floor(columns / 2)));
  const left = fitTerminalLine(line1, Math.max(1, columns - stringWidth(model) - 2));
  const inline = !compact && columns >= 70;
  return (
    <Box flexDirection="column" flexShrink={0}>
      {loop ? <Text color={theme.permission}>{fitTerminalLine(loop, columns)}</Text> : null}
      {inline ? <Text color={theme.dim}>{left}{" ".repeat(Math.max(1, columns - stringWidth(left) - stringWidth(model)))}{model}</Text>
        : <Text color={theme.dim}>{fitTerminalLine(`${modelLabel} · ${line1}`, columns)}</Text>}
    </Box>
  );
}
