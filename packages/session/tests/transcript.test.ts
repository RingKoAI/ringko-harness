import { describe, expect, it } from "bun:test";
import type { AgentEvent } from "@ringko-ai/harness";
import type { SessionEvent } from "../src/types.ts";
import { recordAgentEvent, recordSessionSummary, recordSessionTitle, recordUserMessage, repairInterruptedToolCalls, sessionSummary, sessionTitle, toChatMessages } from "../src/transcript.ts";

function collector(): { events: SessionEvent[]; handle: { appendEvent(type: string, data?: unknown): SessionEvent } } {
  const events: SessionEvent[] = [];
  return {
    events,
    handle: {
      appendEvent(type, data) {
        const event: SessionEvent = { type, seq: events.length, time: 0, ...(data !== undefined ? { data } : {}) };
        events.push(event);
        return event;
      },
    },
  };
}

describe("transcript", () => {
  it("records and reconstructs a conversation", () => {
    const { events, handle } = collector();

    recordUserMessage(handle, "list the files");
    const modelEvent: AgentEvent = {
      type: "model",
      turn: 1,
      message: { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "list_dir", arguments: { path: "." } }] },
    };
    recordAgentEvent(handle, modelEvent);
    const toolEvent: AgentEvent = {
      type: "tool",
      turn: 1,
      message: { role: "tool", content: "a.txt\nb.txt", toolCallId: "c1", name: "list_dir" },
      toolName: "list_dir",
    };
    recordAgentEvent(handle, toolEvent);
    recordAgentEvent(handle, { type: "model", turn: 2, message: { role: "assistant", content: "Two files." } });

    expect(events.map((event) => event.type)).toEqual([
      "user/message",
      "assistant/message",
      "tool/result",
      "assistant/message",
    ]);

    expect(toChatMessages(events)).toEqual([
      { role: "user", content: "list the files" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", name: "list_dir", arguments: { path: "." } }],
      },
      { role: "tool", content: "a.txt\nb.txt", toolCallId: "c1", name: "list_dir" },
      { role: "assistant", content: "Two files." },
    ]);
  });

  it("records a separate pre-execution call without duplicating replay history", () => {
    const { events, handle } = collector();
    recordAgentEvent(handle, {
      type: "model",
      turn: 1,
      message: { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "read", arguments: { path: "a" } }] },
    });
    recordAgentEvent(handle, {
      type: "tool_call",
      turn: 1,
      message: { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "read", arguments: { path: "a" } }] },
    });
    expect(events[1]).toMatchObject({ type: "tool/call", data: { toolCallId: "c1", name: "read" } });
    expect(toChatMessages(events)).toHaveLength(1);
  });

  it("repairs an unmatched legacy call once and preserves the recorded result", () => {
    const { events, handle } = collector();
    recordAgentEvent(handle, {
      type: "model",
      turn: 1,
      message: { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "write", arguments: { path: "a" } }] },
    });
    expect(repairInterruptedToolCalls({ ...handle, all: () => events })).toBe(1);
    expect(repairInterruptedToolCalls({ ...handle, all: () => events })).toBe(0);
    expect(events[1]).toMatchObject({ type: "tool/result", data: { failed: true, toolCallId: "c1" } });
    expect(toChatMessages(events)[1]?.content).toContain("not started before the run was interrupted.");
  });

  it("marks failed tool results", () => {
    const { events, handle } = collector();
    recordAgentEvent(handle, {
      type: "tool_error",
      turn: 1,
      message: { role: "tool", content: "denied", toolCallId: "c1", name: "run_shell" },
    });
    expect(events[0]).toMatchObject({ type: "tool/result", data: { failed: true, name: "run_shell" } });
  });

  it("stores the latest session title and summary", () => {
    const { events, handle } = collector();
    expect(sessionTitle(events)).toBeUndefined();
    expect(sessionSummary(events)).toBeUndefined();
    recordSessionTitle(handle, "first title");
    recordSessionSummary(handle, "did a thing");
    recordSessionTitle(handle, "second title");
    expect(sessionTitle(events)).toBe("second title");
    expect(sessionSummary(events)).toBe("did a thing");
    expect(events.map(event => event.type)).toEqual(["session/title", "session/summary", "session/title"]);
  });

  it("persists and reconstructs structured tool parts", () => {
    const { events, handle } = collector();
    recordAgentEvent(handle, {
      type: "tool",
      turn: 1,
      message: {
        role: "tool",
        content: "Image a.png",
        toolCallId: "c1",
        name: "read",
        parts: [
          { type: "text", text: "Image a.png" },
          { type: "image", mediaType: "image/png", data: "aGVsbG8=" },
        ],
      },
      toolName: "read",
    });

    expect(events[0]?.data).toMatchObject({
      parts: [
        { type: "text", text: "Image a.png" },
        { type: "image", mediaType: "image/png", data: "aGVsbG8=" },
      ],
    });
    expect(toChatMessages(events)[0]).toMatchObject({
      role: "tool",
      content: "Image a.png",
      parts: [
        { type: "text", text: "Image a.png" },
        { type: "image", mediaType: "image/png", data: "aGVsbG8=" },
      ],
    });
  });

  it("drops unvalidated structured parts when loading a session", () => {
    const { events, handle } = collector();
    recordAgentEvent(handle, {
      type: "tool",
      turn: 1,
      message: {
        role: "tool",
        content: "bad",
        toolCallId: "c1",
        name: "read",
        parts: [{ type: "image", mediaType: "image/svg+xml", data: "aGVsbG8=" }],
      },
      toolName: "read",
    });
    expect(toChatMessages(events)[0]).toEqual({ role: "tool", content: "bad", toolCallId: "c1", name: "read" });
  });
});
