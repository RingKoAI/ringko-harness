import { Box, Text } from "ink";
import { truncate } from "../state.ts";
import { theme } from "../theme.ts";

export interface StatusBarProps {
  modelLabel: string;
  workspace: string;
  sessionId?: string;
}

export function StatusBar({ modelLabel, workspace, sessionId }: StatusBarProps) {
  return (
    <Box>
      <Text color={theme.dim}>
        {truncate(modelLabel, 24)} · {truncate(workspace, 40)}
        {sessionId ? ` · ${sessionId}` : ""} · /help
      </Text>
    </Box>
  );
}
