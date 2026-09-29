import { Box, Text } from "ink";
import type { SubagentView } from "../subagent-view.ts";
import { fitTerminalLine } from "../editor.ts";
import { theme } from "../theme.ts";

export function TaskTree({ tasks, selectedId, columns }: { tasks: readonly SubagentView[]; selectedId?: string; columns: number }) {
  if (!tasks.length) return null;
  const selected = tasks.find(task => task.id === selectedId);
  const recent = tasks.slice(-3);
  const visible = selected && !recent.includes(selected) ? [selected, ...tasks.slice(-2)] : recent;
  return <Box flexDirection="column" flexShrink={0} paddingX={1}>
    <Text color={selectedId ? theme.dim : theme.brand}>{fitTerminalLine(`${selectedId ? " " : ">"} Main · ${tasks.length} subagent${tasks.length === 1 ? "" : "s"}`, columns - 2)}</Text>
    {visible.map((task, index) => <Text key={task.id} color={selectedId === task.id ? theme.brand : task.status === "failed" ? theme.error : theme.dim}>
      {fitTerminalLine(`${selectedId === task.id ? ">" : " "} ${index === visible.length - 1 ? "└─" : "├─"} ${task.description} [${task.status}]`, columns - 2)}
    </Text>)}
    <Text color={theme.dim}>{fitTerminalLine(`Ctrl+G switch view${tasks.length > visible.length ? ` · ${tasks.length - visible.length} older tasks` : ""}`, columns - 2)}</Text>
  </Box>;
}
