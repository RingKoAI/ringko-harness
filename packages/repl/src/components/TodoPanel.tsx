import { Box, Text, useStdout } from "ink";
import stringWidth from "string-width";
import type { TodoItem } from "@ringko-ai/tools";
import { fitTerminalLine } from "../editor.ts";
import { theme } from "../theme.ts";

const ICONS: Record<TodoItem["status"], string> = {
  completed: "✔",
  in_progress: "▪",
  pending: "▫",
};

export function TodoPanel({ todos, maxRows = 5 }: { todos: readonly TodoItem[]; maxRows?: number }) {
  const { stdout } = useStdout();
  if (todos.length === 0 || maxRows <= 0) return null;
  const columns = stdout.columns ?? 80;
  const padding = columns > 6 ? 1 : 0;
  const width = Math.max(1, columns - padding * 2);
  const completed = todos.filter(todo => todo.status === "completed").length;
  const indent = width >= 12 ? "  " : "";
  const overflow = todos.length > maxRows - 1;
  const count = Math.max(0, maxRows - 1 - (overflow ? 1 : 0));
  const visible = overflow ? [...todos].sort((a, b) => ({ in_progress: 0, pending: 1, completed: 2 })[a.status] - ({ in_progress: 0, pending: 1, completed: 2 })[b.status]).slice(0, count) : todos;

  return (
    <Box flexDirection="column" paddingX={padding} flexShrink={0}>
      <Text bold color={theme.dim}>{fitTerminalLine(`Todos ${completed}/${todos.length} done${maxRows === 1 ? " · /todos" : ""}`, width)}</Text>
      {visible.map((todo, index) => {
        const done = todo.status === "completed";
        const active = todo.status === "in_progress";
        const label = active && todo.activeForm ? todo.activeForm : todo.content;
        const prefix = `${indent}${ICONS[todo.status]} `;
        return (
          <Text key={`${index}-${todo.content}`} color={active ? theme.brand : done ? theme.dim : undefined} dimColor={done} bold={active}>
            {prefix}{fitTerminalLine(label, width - stringWidth(prefix))}
          </Text>
        );
      })}
      {overflow && maxRows > 1 ? <Text color={theme.dim}>{fitTerminalLine(`  +${todos.length - visible.length} more · /todos`, width)}</Text> : null}
    </Box>
  );
}
