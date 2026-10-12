import { expect, it } from "bun:test";
import type { ChatMessage, ModelClient } from "../src/index.ts";
import { generateSessionMeta } from "../src/session-meta.ts";

function recorder() {
  const events: { type: string; data?: unknown }[] = [];
  let flushes = 0;
  return {
    events,
    flushes: () => flushes,
    handle: {
      appendEvent(type: string, data?: unknown) {
        events.push({ type, ...(data !== undefined ? { data } : {}) });
        return { type, seq: events.length, time: 0 } as never;
      },
      flush() { flushes += 1; },
    },
  };
}

const conversation: ChatMessage[] = [
  { role: "user", content: "Fix the login redirect bug" },
  { role: "assistant", content: "Patched the callback and added a regression test." },
];

const reply = (content: string): ModelClient => async () => ({ content, toolCalls: [] });

it("records a title and summary from a JSON reply, tolerating fenced output", async () => {
  const { events, handle, flushes } = recorder();
  const meta = await generateSessionMeta(reply('```json\n{"title":"Fix login redirect","summary":"Patched the OAuth callback and added a test."}\n```'), conversation, handle);
  expect(meta).toEqual({ title: "Fix login redirect", summary: "Patched the OAuth callback and added a test." });
  expect(events).toEqual([
    { type: "session/title", data: { title: "Fix login redirect" } },
    { type: "session/summary", data: { summary: "Patched the OAuth callback and added a test." } },
  ]);
  expect(flushes()).toBe(1);
});

it("bounds generated values and accepts a partial reply", async () => {
  const { events, handle } = recorder();
  const meta = await generateSessionMeta(reply(JSON.stringify({ title: `  ${"x".repeat(200)}  ` })), conversation, handle);
  expect(meta?.summary).toBeUndefined();
  expect(meta?.title?.length).toBe(80);
  expect(events.map(event => event.type)).toEqual(["session/title"]);
});

it("returns undefined without writing when the reply is unusable or the model fails", async () => {
  const unparseable = recorder();
  expect(await generateSessionMeta(reply("no json here"), conversation, unparseable.handle)).toBeUndefined();
  expect(unparseable.events).toEqual([]);

  const throwing: ModelClient = async () => { throw new Error("network down"); };
  const failing = recorder();
  expect(await generateSessionMeta(throwing, conversation, failing.handle)).toBeUndefined();
  expect(failing.events).toEqual([]);

  const empty = recorder();
  expect(await generateSessionMeta(reply('{"title":"x"}'), [{ role: "system", content: "ignored" }], empty.handle)).toBeUndefined();
  expect(empty.events).toEqual([]);
});

it("only summarizes the most recent bounded messages", async () => {
  const seen: string[] = [];
  const model: ModelClient = async request => { seen.push(request.messages.at(-1)?.content ?? ""); return { content: '{"title":"t","summary":"s"}', toolCalls: [] }; };
  const messages: ChatMessage[] = Array.from({ length: 40 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `message-${index}` }));
  await generateSessionMeta(model, messages, recorder().handle, { maxMessages: 4 });
  expect(seen[0]).toContain("message-39");
  expect(seen[0]).toContain("message-36");
  expect(seen[0]).not.toContain("message-1");
});
