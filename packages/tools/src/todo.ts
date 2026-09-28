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
export const TODO_LIMITS = Object.freeze({ items: 100, characters: 2048 });

function parseTodos(value: unknown): TodoInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected an object input.");
  }
  const list = (value as Record<string, unknown>).todos;
  if (!Array.isArray(list) || list.length > TODO_LIMITS.items) {
    throw new TypeError("Expected an array 'todos'.");
  }
  const todos: TodoItem[] = list.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new TypeError(`Todo ${index} must be an object.`);
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.content !== "string" || record.content.trim().length === 0 || record.content.length > TODO_LIMITS.characters) {
      throw new TypeError(`Todo ${index} requires a non-empty 'content'.`);
    }
    if (record.activeForm !== undefined && (typeof record.activeForm !== "string" || record.activeForm.length > TODO_LIMITS.characters)) throw new TypeError("Invalid todo activeForm.");
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
export function createTodoReadTool(store: TodoStore): ToolDefinition<Record<string, never>, TodoOutput> {
  return defineTool({ name: "todoread", taskAccess: "read", description: "Read the current session todo list, including pending, in_progress and completed items.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, parseInput: value => {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length) throw new TypeError("todoread expects an empty object.");
    return {};
  }, assessRisk: () => ({ kind: "safe", reason: "Read session todos." }), execute: () => ({ todos: store.todos.map(todo => ({ ...todo })) }) });
}
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
      store.onChange?.(next.map(todo => ({ ...todo })));
      store.todos = next;
      return { todos: store.todos.map((todo) => ({ ...todo })) };
    },
  });
}
