import { describe, expect, it } from "bun:test";
import { executeTool } from "@ringko-ai/harness";
import { createTodoStore, createTodoTool } from "../src/todo.ts";

describe("todowrite", () => {
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
    expect(store.todos[1]).toMatchObject({ content: "edit", status: "in_progress" });
  });

  it("rejects invalid entries", async () => {
    const tool = createTodoTool(createTodoStore());
    await expect(executeTool(tool, { todos: [{ content: "", status: "pending" }] }, async () => true)).rejects.toThrow(
      "'content'",
    );
    await expect(executeTool(tool, { todos: [{ content: "x", status: "nope" }] }, async () => true)).rejects.toThrow(
      "status",
    );
  });
});
