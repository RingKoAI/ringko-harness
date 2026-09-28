import { expect, it } from "bun:test";
import { recordAssistantMessage, toChatMessages } from "../src/transcript.ts";
import type { SessionEvent } from "../src/types.ts";

function recorder(): { events: SessionEvent[]; appendEvent(type: string, data?: unknown): SessionEvent } {
  const events: SessionEvent[] = [];
  return {
    events,
    appendEvent(type: string, data?: unknown): SessionEvent {
      const event: SessionEvent = { seq: events.length + 1, time: 1, type, data };
      events.push(event);
      return event;
    },
  };
}

it("persists and replays reasoning with its provider options", () => {
  const handle = recorder();
  recordAssistantMessage(handle, 1, "answer", [{ id: "c1", name: "read", arguments: { path: "a.ts" } }], [
    { text: "thinking", providerOptions: { anthropic: { signature: "sig" } } },
  ]);

  expect(toChatMessages(handle.events)).toEqual([
    {
      role: "assistant",
      content: "answer",
      toolCalls: [{ id: "c1", name: "read", arguments: { path: "a.ts" } }],
      reasoning: "thinking",
      reasoningDetails: [{ text: "thinking", providerOptions: { anthropic: { signature: "sig" } } }],
    },
  ]);
});

it("omits reasoning for assistant turns without it", () => {
  const handle = recorder();
  recordAssistantMessage(handle, 1, "answer", []);

  expect(toChatMessages(handle.events)).toEqual([{ role: "assistant", content: "answer" }]);
});
