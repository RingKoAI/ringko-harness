import { expect, it } from "bun:test";
import { taskSummaries } from "../src/task-log.ts";
import { trajectoryPage } from "../src/trajectory.ts";
import type { SessionEvent } from "../src/types.ts";

it("restores recorded task outcomes and leaves incomplete historical tasks unknown", () => {
  const data = { taskId: "one", description: "Inspect", mode: "read", parentCallId: "root" };
  const started: SessionEvent = { seq: 0, time: 10, type: "task/started", data };
  expect(taskSummaries([started])[0]?.status).toBe("unknown");
  expect(taskSummaries([started], true)[0]?.status).toBe("running");
  const completed: SessionEvent = { seq: 2, time: 30, type: "task/completed", data: { ...data, result: { content: "findings" } } };
  const collision: SessionEvent = { seq: 1, time: 20, type: "tool/call", data: { toolCallId: "task:one" } };
  expect(taskSummaries([started, completed])[0]).toMatchObject({ status: "completed", content: "findings", completedAt: 30 });
  expect(trajectoryPage([started, collision, completed]).records[2]).toMatchObject({ kind: "task", durationMs: 20 });
  expect(taskSummaries([{ ...completed, type: "task/cancelled", data: { ...data, reason: "timeout" } }])).toEqual([]);
  expect(taskSummaries([started, { ...completed, type: "task/cancelled", data: { ...data, reason: "timeout" } }])[0]).toMatchObject({ status: "cancelled", reason: "timeout" });
});
