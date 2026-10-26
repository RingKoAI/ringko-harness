import { describe, expect, it } from "bun:test";
import { ToolRegistry } from "@ringko-ai/harness";
import { createTodoStore, registerSessionTools } from "../src/index.ts";

describe("registerSessionTools", () => {
  it("registers update_plan, plan and ask, and shares the store", async () => {
    const registry = new ToolRegistry();
    const seen: string[] = [];
    const store = registerSessionTools(registry, {
      onTodosChange: (todos) => {
        seen.push(todos.map((todo) => todo.status).join(","));
      },
      ask: async () => ({ answers: [{ id: "go", selected: ["Yes"] }] }),
    });

    expect(registry.names()).toEqual(["update_plan", "plan", "ask"]);
    expect(registry.get("update_plan")?.concurrency).toBe("exclusive");
    expect(registry.get("ask")?.concurrency).toBe("exclusive");

    await registry.call("update_plan", {
      todos: [{ content: "ship ask", status: "in_progress", activeForm: "shipping" }],
    });
    expect(store.todos).toHaveLength(1);
    expect(seen).toEqual(["in_progress"]);
    expect(await registry.call("plan", {})).toMatchObject({ todos: [{ content: "ship ask", status: "in_progress" }] });

    const answer = await registry.call("ask", {
      questions: [{ id: "go", question: "Ship it?", options: [{ label: "Yes" }] }],
    });
    expect(answer).toEqual({ answers: [{ id: "go", selected: ["Yes"] }] });
  });

  it("omits ask when no answerer is supplied and reuses a given store", () => {
    const registry = new ToolRegistry();
    const existing = createTodoStore();
    const returned = registerSessionTools(registry, { todos: existing });

    expect(returned).toBe(existing);
    expect(registry.names()).toEqual(["update_plan", "plan"]);
    expect(registry.has("todowrite")).toBe(false);
    expect(registry.has("todoread")).toBe(false);
    expect(registry.has("ask")).toBe(false);
  });

  it("keeps plan read-only, rejects nonempty arguments and returns independent snapshots", async () => {
    const registry = new ToolRegistry();
    const store = registerSessionTools(registry);
    store.todos = [{ content: "Existing plan", status: "pending" }];
    expect(registry.get("plan")?.taskAccess).toBe("read");
    const result = await registry.call("plan", {}) as { todos: Array<{ content: string }> };
    result.todos[0].content = "Changed copy";
    expect(store.todos[0].content).toBe("Existing plan");
    await expect(registry.call("plan", { todos: [] })).rejects.toThrow("empty object");
  });

  it("does not ask for approval and rejects a bad question", async () => {
    const registry = new ToolRegistry();
    registerSessionTools(registry, {
      ask: async () => ({ answers: [{ id: "q", selected: [] }] }),
    });
    const deny = async () => {
      throw new Error("session tools must not request approval");
    };
    await expect(
      registry.call("update_plan", { todos: [{ content: "note", status: "pending" }] }, deny),
    ).resolves.toMatchObject({ todos: [{ content: "note" }] });
    await expect(
      registry.call("ask", { questions: [{ id: "q", question: "Anything else?" }] }, deny),
    ).resolves.toEqual({ answers: [{ id: "q", selected: [] }] });
    await expect(registry.call("ask", { questions: [] }, deny)).rejects.toThrow("non-empty");
  });
});
