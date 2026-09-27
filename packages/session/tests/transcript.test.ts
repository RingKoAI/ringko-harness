import { describe, expect, it } from "bun:test";
import type { AgentEvent } from "@ringko-ai/harness";
import type { SessionEvent } from "../src/types.ts";
import { recordAgentEvent, recordUserMessage, toChatMessages } from "../src/transcript.ts";

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

  it("marks failed tool results", () => {
    const { events, handle } = collector();
    recordAgentEvent(handle, {
      type: "tool_error",
      turn: 1,
      message: { role: "tool", content: "denied", toolCallId: "c1", name: "run_shell" },
    });
    expect(events[0]).toMatchObject({ type: "tool/result", data: { failed: true, name: "run_shell" } });
  });
});
