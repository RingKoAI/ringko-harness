import { Box, Text } from "ink";
import { truncate } from "../state.ts";
import { theme } from "../theme.ts";

export interface BannerProps {
  modelLabel: string;
  workspace: string;
}

export function Banner({ modelLabel, workspace }: BannerProps) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.brand} paddingX={1} marginBottom={1}>
      <Box>
        <Text color={theme.brand}>✻ </Text>
        <Text bold>RingKo</Text>
        <Text color={theme.dim}>  agent harness</Text>
      </Box>
      <Text color={theme.dim}>
        {modelLabel} · {truncate(workspace, 60)}
      </Text>
    </Box>
  );
}
