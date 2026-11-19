import { expect, it } from "bun:test";
import { restoreTranscript, transcriptTurns } from "../src/transcript.ts";
import type { ServerMessage, SessionEvent } from "@ringko-ai/protocol";

const event = (seq: number, type: string, data: unknown = {}): SessionEvent => ({ seq, type, time: seq, data });
const message = (sourceSeq: number, role: ServerMessage["role"], extra: Partial<ServerMessage> = {}): ServerMessage => ({ sourceSeq, role, content: role, ...extra });

it("restores user-run outcomes and keeps reused tool IDs isolated by source sequence", () => {
  const events = [event(1, "run/started", { runId: "first" }), event(2, "user/message"), event(3, "assistant/message"), event(4, "tool/result", { toolCallId: "same", failed: true }), event(5, "run/failed", { runId: "first" }),
    event(6, "run/started", { runId: "second" }), event(7, "user/message"), event(8, "assistant/message"), event(9, "tool/result", { toolCallId: "same", failed: false }), event(10, "assistant/message"), event(11, "run/completed", { runId: "second" })];
  const messages = [message(2, "user"), message(3, "assistant"), message(4, "tool", { toolCallId: "same" }), message(7, "user"), message(8, "assistant"), message(9, "tool", { toolCallId: "same" }), message(10, "assistant")];
  const restored = restoreTranscript(messages, events);
  expect(restored[0]).toMatchObject({ runStart: 1, runStatus: "failed" });
  expect(restored[3]).toMatchObject({ runStart: 6, runStatus: "completed" });
  expect(restored[2].failed).toBe(true); expect(restored[5].failed).toBe(false);
  expect(transcriptTurns(restored).map(turn => [turn.start, turn.end, turn.status])).toEqual([[0, 3, "failed"], [3, 7, "completed"]]);
  expect(messages[0]).not.toHaveProperty("runStart");
});

it("distinguishes an active run, a process interruption, and cancellation after an answer", () => {
  const events = [event(1, "run/started", { runId: "old" }), event(2, "user/message"), event(3, "assistant/message"), event(4, "run/started", { runId: "new" }), event(5, "user/message"), event(6, "assistant/message")];
  const messages = [message(2, "user"), message(3, "assistant"), message(5, "user"), message(6, "assistant")];
  expect(restoreTranscript(messages, events, true).map(value => value.runStatus)).toEqual(["interrupted", "interrupted", "running", "running"]);
  expect(restoreTranscript(messages, events, false).at(-1)?.runStatus).toBe("interrupted");
  expect(restoreTranscript(messages, [...events, event(7, "run/cancelled", { runId: "new" })]).at(-1)?.runStatus).toBe("cancelled");
});

it("retains recorded run identity when compaction removes the opening user message", () => {
  const events = [event(1, "run/started"), event(2, "user/message"), event(3, "assistant/message"), event(4, "tool/result"), event(5, "assistant/message"), event(6, "run/completed"), event(7, "session/compaction")];
  const restored = restoreTranscript([message(7, "system"), message(3, "assistant"), message(4, "tool"), message(5, "assistant")], events);
  expect(transcriptTurns(restored)).toEqual([{ start: 0, end: 4, runStart: 1, status: "completed" }]);
});

it("supports legacy input boundaries and shell results without inventing success for missing results", () => {
  const legacy = [event(1, "user/message"), event(2, "assistant/message"), event(3, "tool/result")];
  expect(restoreTranscript([message(1, "user")], legacy)[0].runStatus).toBeUndefined();
  const shell = [event(1, "run/started", { kind: "shell" }), event(2, "user/message"), event(3, "tool/result", { failed: false })];
  expect(restoreTranscript([message(2, "user")], shell)[0].runStatus).toBe("completed");
  expect(restoreTranscript([message(2, "user")], shell, true)[0].runStatus).toBe("running");
  expect(restoreTranscript([message(2, "user")], shell.slice(0, -1))[0].runStatus).toBe("interrupted");
  expect(transcriptTurns([{ role: "user" }, { role: "assistant" }, { role: "user" }, { role: "tool" }]).map(turn => turn.userIndex)).toEqual([0, 2]);
});

it("binds mid-run steered user messages to the enclosing explicit run", () => {
  const events = [
    event(1, "run/started", { runId: "steered-run" }),
    event(2, "user/message", { content: "initial" }),
    event(3, "assistant/message"),
    event(4, "tool/result", { toolCallId: "t1", failed: false }),
    event(5, "user/message", { content: "steered", id: "s1" }),
    event(6, "assistant/message"),
    event(7, "run/completed", { runId: "steered-run" }),
  ];
  const messages = [
    message(2, "user", { content: "initial" }),
    message(3, "assistant"),
    message(4, "tool", { toolCallId: "t1" }),
    message(5, "user", { content: "steered" }),
    message(6, "assistant"),
  ];
  const restored = restoreTranscript(messages, events);
  expect(restored.every(item => item.runStart === 1 && item.runStatus === "completed")).toBe(true);
  expect(transcriptTurns(restored)).toEqual([
    { start: 0, end: 3, userIndex: 0, runStart: 1, status: "completed" },
    { start: 3, end: 5, userIndex: 3, runStart: 1, status: "completed" },
  ]);
});
