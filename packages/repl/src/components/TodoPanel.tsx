import { Box, Text, useStdout } from "ink";
import stringWidth from "string-width";
import type { TodoItem } from "@ringko-ai/tools";
import { fitTerminalLine } from "../editor.ts";
import { GLYPH } from "../glyphs.ts";
import { theme } from "../theme.ts";
import { terminalColumns } from "../terminal-layout.ts";

const ICONS: Record<TodoItem["status"], string> = {
  completed: GLYPH.tick,
  in_progress: GLYPH.squareOn,
  pending: GLYPH.squareOff,
};

const RANK: Record<TodoItem["status"], number> = { in_progress: 0, pending: 1, completed: 2 };

export function TodoPanel({ todos, maxRows = 5 }: { todos: readonly TodoItem[]; maxRows?: number }) {
  const { stdout } = useStdout();
  if (todos.length === 0 || maxRows <= 0) return null;
  const columns = terminalColumns(stdout.columns ?? 80);
  const padding = columns > 6 ? 1 : 0;
  const width = Math.max(1, columns - padding * 2);
  const completed = todos.filter(todo => todo.status === "completed").length;
  const inProgress = todos.filter(todo => todo.status === "in_progress").length;
  const open = todos.length - completed - inProgress;
  const indent = width >= 12 ? "  " : "";
  const overflow = todos.length > maxRows - 1;
  const count = Math.max(0, maxRows - 1 - (overflow ? 1 : 0));
  const visible = overflow ? [...todos].sort((a, b) => RANK[a.status] - RANK[b.status]).slice(0, count) : todos;
  const header = `${todos.length} step${todos.length === 1 ? "" : "s"} (${completed} done${inProgress > 0 ? `, ${inProgress} in progress` : ""}, ${open} open)`;

  return (
    <Box flexDirection="column" paddingX={padding} flexShrink={0}>
      <Text bold color={theme.dim}>{fitTerminalLine(`${header}${maxRows === 1 ? " · /todos" : ""}`, width)}</Text>
      {visible.map((todo, index) => {
        const done = todo.status === "completed";
        const active = todo.status === "in_progress";
        const label = active && todo.activeForm ? `${todo.activeForm}${GLYPH.ellipsis}` : todo.content;
        const prefix = `${indent}${ICONS[todo.status]} `;
        return (
          <Text key={`${index}-${todo.content}`} color={active ? theme.brand : done ? theme.dim : undefined} dimColor={done} bold={active} strikethrough={done}>
            {prefix}{fitTerminalLine(label, width - stringWidth(prefix))}
          </Text>
        );
      })}
      {overflow && maxRows > 1 ? <Text color={theme.dim}>{fitTerminalLine(`${indent}+${todos.length - visible.length} more · /todos`, width)}</Text> : null}
    </Box>
  );
}
