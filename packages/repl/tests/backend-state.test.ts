import { expect, it } from "bun:test";
import type { SessionSnapshot } from "@ringko-ai/client";
import { snapshotItems, snapshotTasks } from "../src/backend-state.ts";

function snapshot(): SessionSnapshot {
  return {
    id: "fixture", instance: "instance", revision: 1, title: null, summary: null, archived: false,
    messages: [{ role: "user", content: "Inspect" }, { role: "assistant", content: "", toolCalls: [{ id: "call", name: "read", arguments: { path: "file" } }] }],
    events: [{ seq: 0, time: 1, type: "tool/call", data: { toolCallId: "call", name: "read", arguments: { path: "file" } } }],
    busy: true, approvals: [], questions: [], tasks: [], todos: [], jobs: [],
    partial: { reasoning: "Shared thinking", content: "Shared answer" }, loop: null, error: null,
  };
}

it("restores active tool calls and partial output when a terminal attaches mid-turn", () => {
  const items = snapshotItems(snapshot());
  expect(items.find(item => item.toolCallId === "call")).toMatchObject({ running: true, incomplete: false, arguments: { path: "file" } });
  expect(items.some(item => item.kind === "thinking" && item.text === "Shared thinking")).toBe(true);
  expect(items.some(item => item.kind === "assistant" && item.text === "Shared answer")).toBe(true);
});

it("does not show historical tool calls or interrupted subagents as still running", () => {
  const value = snapshot(); value.busy = false; value.partial = null;
  value.events.push({ seq: 1, time: 2, type: "task/started", data: { type: "started", taskId: "task", parentCallId: null, description: "Inspect", mode: "read", model: "Fixture/model", time: 2 } });
  expect(snapshotItems(value).find(item => item.toolCallId === "call")).toMatchObject({ running: false, incomplete: true });
  expect(snapshotTasks(value)[0].status).toBe("cancelled");
});
