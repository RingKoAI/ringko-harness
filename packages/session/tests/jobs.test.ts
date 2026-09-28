import { expect, it } from "bun:test";
import { sessionJobs } from "../src/jobs.ts";
import { sessionTodos } from "../src/todos.ts";
import { toChatMessages } from "../src/transcript.ts";
import type { SessionEvent } from "../src/types.ts";
const event = (type: string, data: unknown): SessionEvent => ({ seq: 1, time: 1, type, data });
it("restores unknown interrupted jobs, terminal results, todos and model notifications", () => {
  const started = event("job/sub/started", { jobId: "one", kind: "sub", type: "started", seq: 0, data: { description: "Inspect", background: false } });
  const detached = event("job/sub/background", { jobId: "one", kind: "sub", type: "background", seq: 1, data: { background: true } });
  expect(sessionJobs([started, detached])).toMatchObject([{ status: "unknown", background: true }]);
  expect(sessionJobs([started], true)[0].status).toBe("running");
  const completed = event("job/sub/completed", { jobId: "one", kind: "sub", type: "completed", seq: 2, data: { result: "findings" } });
  expect(sessionJobs([started, detached, completed])).toMatchObject([{ status: "completed", result: "findings", lastSeq: 2 }]);
  const todos = [{ content: "Inspect", status: "completed" as const }];
  expect(sessionTodos([event("session/todo", { todos }), event("session/todo", { todos: [{ status: "invalid" }] })])).toEqual(todos);
  expect(toChatMessages([event("session/notification", { content: "Background result" })])).toEqual([{ role: "system", content: "Background result" }]);
});
