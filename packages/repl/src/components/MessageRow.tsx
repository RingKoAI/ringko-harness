import { Box, Text } from "ink";
import type { ReplItem } from "../state.ts";
import { theme } from "../theme.ts";

export function MessageRow({ item }: { item: ReplItem }) {
  if (item.kind === "user") {
    return (
      <Box marginTop={1}>
        <Text color="white" backgroundColor={theme.userBackground}>
          {" ❯ "}
          {item.text} 
        </Text>
      </Box>
    );
  }
  if (item.kind === "notice") {
    return (
      <Box>
        <Text color={theme.dim}>{item.text}</Text>
      </Box>
    );
  }
  if (item.kind === "assistant") {
    return (
      <Box flexDirection="row">
        <Text color={theme.brand}>⏺ </Text>
        <Text>{item.text}</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={item.failed ? theme.error : theme.tool}>⏺ </Text>
        <Text bold>{item.toolName ?? "tool"}</Text>
      </Box>
      <Box>
        <Text color={theme.dim}>{"  ⎿  "}</Text>
        <Text color={item.failed ? theme.error : undefined}>{item.text}</Text>
      </Box>
    </Box>
  );
}
