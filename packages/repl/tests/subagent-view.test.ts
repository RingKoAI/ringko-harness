import { expect, it } from "bun:test";
import type { TaskEvent } from "@ringko-ai/sdk";
import { applyTaskView, restoreTaskViews } from "../src/subagent-view.ts";

const started: TaskEvent = { taskId: "child-1", parentCallId: "parent-call", description: "Inspect files", model: "fixture", mode: "read", type: "started", time: 1 };

it("keeps child tool results in their own task tree view and restores session history", () => {
  const events: TaskEvent[] = [started,
    { ...started, type: "event", event: { type: "tool_call", turn: 1, message: { role: "assistant", content: "", toolCalls: [{ id: "tool-1", name: "read", arguments: { path: "src/main.ts" } }] } } },
    { ...started, type: "event", event: { type: "tool", turn: 1, message: { role: "tool", toolCallId: "tool-1", name: "read", content: "file contents" } } },
    { ...started, type: "completed" },
  ];
  const views = events.reduce(applyTaskView, [] as ReturnType<typeof applyTaskView>);
  expect(views[0]).toMatchObject({ id: "child-1", parentCallId: "parent-call", status: "completed" });
  expect(views[0]?.items).toMatchObject([{ kind: "tool", toolName: "read", arguments: { path: "src/main.ts" }, text: "file contents", running: false }]);
  const restored = restoreTaskViews(events.map((data, seq) => ({ seq, time: seq, type: `task/${data.type}`, data })) as never);
  expect(restored[0]?.status).toBe("completed");
  expect(restored[0]?.items).toMatchObject([{ kind: "tool", toolName: "read", text: "file contents", running: false }]);
});

it("bounds task logs and ignores malformed replay events", () => {
  const event: TaskEvent = { ...started, type: "event", event: { type: "model", turn: 1, message: { role: "assistant", content: "x".repeat(40_000) } } };
  let views = applyTaskView([], started);
  views = applyTaskView(views, event);
  expect(views[0]?.items[0]?.text.length).toBeLessThan(9000);
  expect(applyTaskView(views, { ...event, event: { ...event.event!, message: {} } } as never)).toEqual(views);
  views = applyTaskView(views, { ...started, type: "cancelled", reason: "timeout" });
  expect(views[0]).toMatchObject({ status: "cancelled", reason: "timeout" });
});
