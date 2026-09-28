import { defineTool, type ToolDefinition } from "@ringko-ai/harness";

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  content: string;
  status: TodoStatus;
  /** Present-continuous label shown while the task is in progress. */
  activeForm?: string;
}

/** In-memory todo list shared between the tool and the host UI. */
export interface TodoStore {
  todos: TodoItem[];
  /** Notified whenever the list changes (host UI hook). */
  onChange?: (todos: TodoItem[]) => void;
}

export function createTodoStore(onChange?: (todos: TodoItem[]) => void): TodoStore {
  return onChange ? { todos: [], onChange } : { todos: [] };
}

export interface TodoInput {
  todos: TodoItem[];
}

export interface TodoOutput {
  todos: TodoItem[];
}

const STATUSES = new Set<TodoStatus>(["pending", "in_progress", "completed"]);

function parseTodos(value: unknown): TodoInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected an object input.");
  }
  const list = (value as Record<string, unknown>).todos;
  if (!Array.isArray(list)) {
    throw new TypeError("Expected an array 'todos'.");
  }
  const todos: TodoItem[] = list.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new TypeError(`Todo ${index} must be an object.`);
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.content !== "string" || record.content.trim().length === 0) {
      throw new TypeError(`Todo ${index} requires a non-empty 'content'.`);
    }
    if (typeof record.status !== "string" || !STATUSES.has(record.status as TodoStatus)) {
      throw new TypeError(`Todo ${index} requires a status of pending|in_progress|completed.`);
    }
    return {
      content: record.content,
      status: record.status as TodoStatus,
      ...(typeof record.activeForm === "string" ? { activeForm: record.activeForm } : {}),
    };
  });
  return { todos };
}

/** Replace the session todo list. Safe: local state only. */
export function createTodoTool(store: TodoStore): ToolDefinition<TodoInput, TodoOutput> {
  return defineTool<TodoInput, TodoOutput>({
    name: "todowrite",
    concurrency: "exclusive",
    description:
      "Create and update the session task list. Send the full list each time; status is pending, in_progress, or completed.",
    inputSchema: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              content: { type: "string" },
              status: { type: "string", enum: ["pending", "in_progress", "completed"] },
              activeForm: { type: "string" },
            },
            required: ["content", "status"],
          },
        },
      },
      required: ["todos"],
      additionalProperties: false,
    },
    parseInput: parseTodos,
    assessRisk() {
      return { kind: "safe", reason: "Update the in-memory task list." };
    },
    execute({ todos }) {
      const next = todos.map((todo) => ({ ...todo }));
      store.todos = next;
      store.onChange?.(store.todos);
      return { todos: store.todos.map((todo) => ({ ...todo })) };
    },
  });
}
