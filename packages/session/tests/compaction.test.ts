import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "../src/store.ts";
import {
  recordAssistantMessage,
  recordSessionCompaction,
  recordToolResult,
  recordUserMessage,
  toChatMessages,
  toChatSurface,
} from "../src/transcript.ts";
import { selectCompactionTail } from "../src/compaction.ts";

describe("session compaction", () => {
  it("replaces only the recorded span and keeps the retained tail in place", () => {
    const root = mkdtempSync(join(tmpdir(), "ringko-compact-replace-"));
    try {
      const store = new SessionStore({ root, cwd: "/work" });
      const session = store.create();
      const oldUser = recordUserMessage(session, "old question");
      const oldAnswer = recordAssistantMessage(session, 1, "old answer", []);
      recordUserMessage(session, "retained question");
      recordAssistantMessage(session, 2, "retained answer", []);
      recordSessionCompaction(session, "Summary of the old question.", [oldUser.seq, oldAnswer.seq]);
      recordUserMessage(session, "after compaction");
      session.flush();
      session.close();

      const events = store.open(session.id, "read").all();
      expect(toChatMessages(events)).toEqual([
        { role: "system", content: "Conversation summary so far:\nSummary of the old question." },
        { role: "user", content: "retained question" },
        { role: "assistant", content: "retained answer" },
        { role: "user", content: "after compaction" },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("moves the retained cut before an assistant tool call instead of orphaning a result", () => {
    const root = mkdtempSync(join(tmpdir(), "ringko-compact-tools-"));
    try {
      const store = new SessionStore({ root, cwd: "/work" });
      const session = store.create();
      recordUserMessage(session, "run the tool");
      recordAssistantMessage(session, 1, "", [{ id: "call-1", name: "read", arguments: { path: "a" } }]);
      recordToolResult(session, 1, "call-1", "read", "tool output", false);
      recordUserMessage(session, "continue");
      recordAssistantMessage(session, 2, "final answer", []);
      session.flush();

      const surface = toChatSurface(store.open(session.id, "read").all());
      const selected = selectCompactionTail(surface, 3);
      expect(selected?.shadowed.map(node => node.message.content)).toEqual(["run the tool"]);
      expect(selected?.retained[0]?.message.role).toBe("assistant");
      expect(selected?.retained.some(node => node.message.role === "tool")).toBe(true);
      session.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps legacy restart-from-summary events replayable", () => {
    const root = mkdtempSync(join(tmpdir(), "ringko-compact-"));
    try {
      const store = new SessionStore({ root, cwd: "/work" });
      const session = store.create();
      recordUserMessage(session, "old question");
      recordAssistantMessage(session, 1, "old answer", []);
      recordSessionCompaction(session, "Summary: discussed the old question.");
      recordUserMessage(session, "new question");
      session.flush();
      session.close();

      const events = store.open(session.id, "read").all();
      const messages = toChatMessages(events);
      expect(messages).toEqual([
        { role: "system", content: "Summary: discussed the old question." },
        { role: "user", content: "new question" },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
