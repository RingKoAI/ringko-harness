import { describe, expect, it } from "bun:test";
import { executeTool } from "@ringko-ai/harness";
import { createTodoStore, createTodoTool } from "../src/todo.ts";

describe("todowrite", () => {
  it("retains the previous snapshot when persistence fails", async () => {
    const store = createTodoStore(() => { throw new Error("Disk full"); });
    store.todos = [{ content: "Previous", status: "pending" }];
    await expect(executeTool(createTodoTool(store), { todos: [{ content: "Next", status: "completed" }] })).rejects.toThrow("Disk full");
    expect(store.todos).toEqual([{ content: "Previous", status: "pending" }]);
  });
  it("stores the list without approval", async () => {
    const store = createTodoStore();
    const tool = createTodoTool(store);
    const output = await executeTool(
      tool,
      {
        todos: [
          { content: "read", status: "completed" },
          { content: "edit", status: "in_progress", activeForm: "editing" },
          { content: "test", status: "pending" },
        ],
      },
      async () => {
        throw new Error("todowrite must not request approval");
      },
    );

    expect(output.todos).toHaveLength(3);
    expect(store.todos[1]).toMatchObject({ content: "edit", status: "in_progress", activeForm: "editing" });
    output.todos[0].content = "mutated";
    expect(store.todos[0]?.content).toBe("read");
  });

  it("replaces the whole list and can clear it", async () => {
    const seen: number[] = [];
    const store = createTodoStore((todos) => {
      seen.push(todos.length);
    });
    const tool = createTodoTool(store);
    await executeTool(
      tool,
      {
        todos: [
          { content: "keep", status: "pending" },
          { content: "drop", status: "pending" },
        ],
      },
      async () => true,
    );
    const replaced = await executeTool(tool, { todos: [{ content: "keep", status: "completed" }] }, async () => true);
    expect(replaced.todos).toEqual([{ content: "keep", status: "completed" }]);
    expect(store.todos.map((todo) => todo.content)).toEqual(["keep"]);

    const cleared = await executeTool(tool, { todos: [] }, async () => true);
    expect(cleared.todos).toEqual([]);
    expect(store.todos).toEqual([]);
    expect(seen).toEqual([2, 1, 0]);
  });

  it("rejects invalid entries without touching the stored list", async () => {
    const store = createTodoStore();
    const tool = createTodoTool(store);
    await expect(executeTool(tool, { todos: [{ content: "", status: "pending" }] }, async () => true)).rejects.toThrow(
      "'content'",
    );
    await expect(executeTool(tool, { todos: [{ content: "x", status: "nope" }] }, async () => true)).rejects.toThrow(
      "status",
    );
    await expect(executeTool(tool, { todos: "nope" }, async () => true)).rejects.toThrow("'todos'");
    await expect(executeTool(tool, null, async () => true)).rejects.toThrow("object input");
    expect(store.todos).toEqual([]);
  });
});
