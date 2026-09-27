import { Box, Text } from "ink";
import { homedir } from "node:os";
import { truncate } from "../state.ts";
import { theme } from "../theme.ts";

export interface StatusBarProps {
  modelLabel: string;
  workspace: string;
  title?: string;
}

/** Collapse the home directory to `~` (like the pi footer). */
function formatCwd(path: string): string {
  const home = homedir();
  if (home.length > 0 && path.startsWith(home)) return `~${path.slice(home.length)}`;
  return path;
}

const HINTS = "/help · /model · /resume";

export function StatusBar({ modelLabel, workspace, title }: StatusBarProps) {
  const line1 = title ? `${formatCwd(workspace)} • ${title}` : formatCwd(workspace);
  return (
    <Box flexDirection="column">
      <Text color={theme.dim}>{truncate(line1, 200)}</Text>
      <Box justifyContent="space-between">
        <Text color={theme.dim}>{HINTS}</Text>
        <Text color={theme.dim}>{truncate(modelLabel, 60)}</Text>
      </Box>
    </Box>
  );
}
