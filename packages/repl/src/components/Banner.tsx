import { Box, Text, useStdout } from "ink";
import { theme } from "../theme.ts";
import { fitTerminalLine } from "../editor.ts";

export interface BannerProps {
  modelLabel: string;
  workspace: string;
}

export function Banner({ modelLabel, workspace }: BannerProps) {
  const { stdout } = useStdout();
  return (
    <Box flexShrink={0}>
      <Text color={theme.brand} bold>{fitTerminalLine(`RingKo · ${modelLabel} · ${workspace}`, stdout.columns ?? 80)}</Text>
    </Box>
  );
}
