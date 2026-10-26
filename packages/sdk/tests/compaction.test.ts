import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore, recordAssistantMessage, recordToolResult, recordUserMessage, toChatMessages } from "@ringko-ai/session";
import { createRingKo } from "../src/index.ts";

it("keeps in-memory history identical to replay after a tool-paired compaction", async () => {
  const root = mkdtempSync(join(tmpdir(), "ringko-sdk-compact-"));
  try {
    const store = new SessionStore({ root, cwd: root });
    const session = store.create();
    recordUserMessage(session, "old request");
    recordAssistantMessage(session, 1, "", [{ id: "call-1", name: "read", arguments: { path: "a" } }]);
    recordToolResult(session, 1, "call-1", "read", "tool output", false);
    recordUserMessage(session, "retained request");
    session.flush();

    const agent = createRingKo({
      session,
      history: toChatMessages(session.all()),
      compaction: { keepRecent: 2 },
      smallModel: async () => ({ content: "Summary of the old request", toolCalls: [] }),
      model: async () => ({ content: "done", toolCalls: [] }),
    });
    const result = await agent.compact();
    expect(result.compacted).toBe(true);
    expect(agent.history).toEqual(toChatMessages(session.all()));
    expect(agent.history[0]?.role).toBe("system");
    expect(agent.history[0]?.content).toContain("Summary of the old request");
    expect(agent.history.some(message => message.content === "retained request")).toBe(true);
    const toolIndex = agent.history.findIndex(message => message.role === "tool");
    expect(toolIndex).toBeGreaterThan(0);
    expect(agent.history[toolIndex - 1]?.role).toBe("assistant");
    const logged = session.all();
    expect(logged.some(event => event.type === "user/message" && (event.data as { content?: string }).content === "old request")).toBe(true);
    expect(logged.find(event => event.type === "session/compaction")?.data).toMatchObject({ summary: "Summary of the old request" });

    recordUserMessage(session, "next request");
    recordAssistantMessage(session, 2, "next answer", []);
    session.flush();
    expect((await agent.compact()).compacted).toBe(true);
    expect(agent.history.filter(message => message.role === "system" && message.content.startsWith("Conversation summary so far:"))).toHaveLength(1);
    expect(agent.history).toEqual(toChatMessages(session.all()));
    session.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
