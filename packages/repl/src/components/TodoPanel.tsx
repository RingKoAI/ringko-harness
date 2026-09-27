import { Box, Text } from "ink";
import type { TodoItem } from "@ringko-ai/tools";
import { theme } from "../theme.ts";

const ICONS: Record<TodoItem["status"], string> = {
  completed: "✔",
  in_progress: "▪",
  pending: "▫",
};

export function TodoPanel({ todos }: { todos: readonly TodoItem[] }) {
  if (todos.length === 0) return null;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1}>
      {todos.map((todo, index) => {
        const done = todo.status === "completed";
        const active = todo.status === "in_progress";
        const label = active && todo.activeForm ? todo.activeForm : todo.content;
        return (
          <Text key={`${index}-${todo.content}`} color={active ? theme.brand : done ? theme.dim : undefined} dimColor={done} bold={active}>
            {ICONS[todo.status]} {label}
          </Text>
        );
      })}
    </Box>
  );
}
