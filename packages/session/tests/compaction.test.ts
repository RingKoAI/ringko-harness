import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "../src/store.ts";
import {
  recordAssistantMessage,
  recordSessionCompaction,
  recordUserMessage,
  toChatMessages,
} from "../src/transcript.ts";

describe("session compaction", () => {
  it("replays the summary plus everything logged after it", () => {
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
