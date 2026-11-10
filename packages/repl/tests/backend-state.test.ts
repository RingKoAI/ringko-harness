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

it("retains display identities across snapshot refreshes and streaming growth", () => {
  const value = snapshot();
  const before = snapshotItems(value);
  value.partial = { reasoning: "Shared thinking", content: "Shared answer grows" };
  const after = snapshotItems(value);
  expect(after.map(item => item.id)).toEqual(before.map(item => item.id));
  expect(after.every(item => item.id < 0)).toBe(true);
  expect(after.at(-1)?.text).toBe("Shared answer grows");
});

it("shows backend model failures without rendering the raw response body", () => {
  const value = snapshot();
  value.busy = false; value.partial = null;
  value.error = "Model is unavailable | status=400 | body=raw diagnostic response";
  const failure = snapshotItems(value).at(-1);
  expect(failure).toMatchObject({ kind: "assistant", failed: true, text: "Request failed: Model is unavailable" });
});

it("does not revive a cancelled turn's pending calls during a new run", () => {
  const value = snapshot(); value.partial = null;
  const old = { id: "old", name: "read", arguments: {} }, current = { id: "new", name: "write", arguments: {} };
  value.messages = [{ role: "user", content: "old", sourceSeq: 2 }, { role: "assistant", content: "", sourceSeq: 3, toolCalls: [old] }, { role: "user", content: "new", sourceSeq: 7 }, { role: "assistant", content: "", sourceSeq: 8, toolCalls: [current] }];
  value.events = [
    { seq: 1, time: 1, type: "run/started", data: { runId: "old" } }, { seq: 2, time: 2, type: "user/message" }, { seq: 3, time: 3, type: "assistant/message", data: { toolCalls: [old] } }, { seq: 4, time: 4, type: "tool/call", data: { toolCallId: "old", name: "read" } }, { seq: 5, time: 5, type: "run/cancelled", data: { runId: "old" } },
    { seq: 6, time: 6, type: "run/started", data: { runId: "new" } }, { seq: 7, time: 7, type: "user/message" }, { seq: 8, time: 8, type: "assistant/message", data: { toolCalls: [current] } }, { seq: 9, time: 9, type: "tool/call", data: { toolCallId: "new", name: "write" } },
  ];
  const items = snapshotItems(value);
  expect(items.find(item => item.toolCallId === "old")).toMatchObject({ running: false, incomplete: true, runStatus: "cancelled" });
  expect(items.find(item => item.toolCallId === "new")).toMatchObject({ running: true, runStatus: "running" });
});
