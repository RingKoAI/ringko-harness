import { describe, expect, it } from "bun:test";
import { toolLogEntries } from "../src/tool-log.ts";
import type { SessionEvent } from "../src/types.ts";

function event(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, type, time: 1_000 + seq * 10, data };
}

describe("toolLogEntries", () => {
  it("pairs calls and results while preserving execution timing and failures", () => {
    const entries = toolLogEntries([
      event(0, "assistant/message", {
        turn: 1,
        toolCalls: [
          { id: "a", name: "read", arguments: { path: "a.txt" } },
          { id: "b", name: "shell", arguments: { command: "exit 1" } },
        ],
      }),
      event(1, "tool/call", { turn: 1, toolCallId: "a", name: "read" }),
      event(2, "tool/call", { turn: 1, toolCallId: "b", name: "shell" }),
      event(3, "tool/result", { turn: 1, toolCallId: "a", name: "read", content: "text", failed: false }),
      event(4, "tool/result", { turn: 1, toolCallId: "b", name: "shell", content: "failed", failed: true }),
    ]);
    expect(entries).toMatchObject([
      { callId: "a", name: "read", status: "success", requestedAt: 1_000, startedAt: 1_010, completedAt: 1_030, result: "text" },
      { callId: "b", name: "shell", status: "error", requestedAt: 1_000, startedAt: 1_020, completedAt: 1_040, result: "failed" },
    ]);
  });

  it("shows legacy calls without start events and unmatched calls", () => {
    const entries = toolLogEntries([
      event(0, "assistant/message", { turn: 2, toolCalls: [
        { id: "old", name: "grep", arguments: { pattern: "x" } },
        { id: "pending", name: "write", arguments: { path: "a" } },
      ] }),
      event(1, "tool/result", { toolCallId: "old", name: "grep", content: "ok", failed: false }),
    ]);
    expect(entries[0]).toMatchObject({ status: "success", startedAt: null, completedAt: 1_010 });
    expect(entries[1]).toMatchObject({ status: "pending", startedAt: null, completedAt: null });
  });
});
