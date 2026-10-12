import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forkSession, messageSeqAt } from "../src/fork.ts";
import { SessionStore } from "../src/store.ts";
import { recordUserMessage } from "../src/transcript.ts";

function withStore(test: (store: SessionStore, root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "ringko-fork-"));
  try { test(new SessionStore({ root, cwd: root }), root); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

it("branches a whole session into a child that links back to its parent", () => withStore(store => {
  const source = store.create({ id: "source" });
  recordUserMessage(source, "one");
  recordUserMessage(source, "two");
  source.flush();
  source.close();

  const childId = forkSession(store, "source");
  const child = store.open(childId, "read");
  expect(child.header.parentSession).toBe("source");
  expect(child.all().filter(event => event.type === "user/message").map(event => (event.data as { content: string }).content)).toEqual(["one", "two"]);
}));

it("branches at a message index and reports a missing session", () => withStore(store => {
  const source = store.create({ id: "source" });
  recordUserMessage(source, "one");
  recordUserMessage(source, "two");
  recordUserMessage(source, "three");
  source.flush();
  source.close();

  const childId = forkSession(store, "source", { index: 0 });
  expect(store.open(childId, "read").all().filter(event => event.type === "user/message")).toHaveLength(1);
  expect(() => forkSession(store, "missing")).toThrow();
}));

it("maps a message index to the right event sequence, resetting after compaction", () => {
  const events = [
    { type: "user/message", seq: 0, time: 0 },
    { type: "session/compaction", seq: 1, time: 0 },
    { type: "user/message", seq: 2, time: 0 },
    { type: "assistant/message", seq: 3, time: 0 },
  ] as unknown as Parameters<typeof messageSeqAt>[0];
  expect(messageSeqAt(events, 0)).toBe(0);
  // After the compaction boundary the index restarts, so message #1 is the post-compaction assistant turn.
  expect(messageSeqAt(events, 1)).toBe(3);
  expect(messageSeqAt(events, 99)).toBe(3);
});
