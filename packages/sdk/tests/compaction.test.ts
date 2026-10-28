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

it("gives the summarizer the tool names and arguments, not only message content", async () => {
  const root = mkdtempSync(join(tmpdir(), "ringko-sdk-compact-args-"));
  try {
    const store = new SessionStore({ root, cwd: root });
    const session = store.create();
    recordUserMessage(session, "edit config");
    recordAssistantMessage(session, 1, "", [{ id: "call-edit", name: "edit", arguments: { path: "unique-config-path-9182", old_string: "before-value-3182", new_string: "after-value-4417" } }]);
    recordToolResult(session, 1, "call-edit", "edit", "{\"ok\":true}", false);
    recordUserMessage(session, "retained");
    session.flush();
    let summaryInput = "";
    const agent = createRingKo({
      session,
      history: toChatMessages(session.all()),
      compaction: { keepRecent: 1 },
      smallModel: async request => { summaryInput = request.messages.at(-1)?.content ?? ""; return { content: "summary", toolCalls: [] }; },
      model: async () => ({ content: "done", toolCalls: [] }),
    });
    expect((await agent.compact()).compacted).toBe(true);
    expect(summaryInput).toContain("unique-config-path-9182");
    expect(summaryInput).toContain("before-value-3182");
    expect(summaryInput).toContain("after-value-4417");
    session.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("aborts an in-flight automatic summary and does not record the prompt", async () => {
  const root = mkdtempSync(join(tmpdir(), "ringko-sdk-compact-abort-"));
  try {
    const store = new SessionStore({ root, cwd: root });
    const session = store.create();
    for (let turn = 0; turn < 4; turn++) {
      recordUserMessage(session, "old request ".repeat(400));
      recordAssistantMessage(session, turn + 1, "old answer ".repeat(400), []);
    }
    session.flush();
    let summarizerSignal: AbortSignal | undefined;
    let entered!: () => void;
    const began = new Promise<void>(resolve => { entered = resolve; });
    const agent = createRingKo({
      session,
      history: toChatMessages(session.all()),
      contextWindow: 4096,
      reserveOutputTokens: 512,
      compaction: { ratio: 0, keepRecent: 1 },
      smallModel: async request => {
        summarizerSignal = request.signal;
        entered();
        await new Promise<void>((_resolve, reject) => {
          request.signal?.addEventListener("abort", () => reject(request.signal?.reason), { once: true });
        });
        return { content: "late summary", toolCalls: [] };
      },
      model: async () => ({ content: "primary response", toolCalls: [] }),
    });
    const controller = new AbortController();
    const run = agent.run("new request", { signal: controller.signal });
    await began;
    controller.abort(new Error("user cancelled"));
    await expect(run).rejects.toThrow();
    expect(summarizerSignal).toBeDefined();
    const logged = session.all();
    expect(logged.some(event => event.type === "session/compaction")).toBe(false);
    expect(logged.some(event => event.type === "user/message" && (event.data as { content?: string }).content === "new request")).toBe(false);
    session.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("compacts between model calls when tool output pushes the next request over budget", async () => {
  const root = mkdtempSync(join(tmpdir(), "ringko-sdk-compact-midrun-"));
  try {
    const store = new SessionStore({ root, cwd: root });
    const session = store.create();
    recordUserMessage(session, "earlier request");
    recordAssistantMessage(session, 1, "earlier answer", []);
    session.flush();
    let summaries = 0;
    let modelCalls = 0;
    let secondCharacters = 0;
    const agent = createRingKo({
      session,
      history: toChatMessages(session.all()),
      contextWindow: 4096,
      reserveOutputTokens: 512,
      compaction: { margin: 0, ratio: 0.8, keepRecent: 0 },
      smallModel: async () => { summaries++; return { content: "mid-run summary", toolCalls: [] }; },
      model: async request => {
        modelCalls++;
        if (modelCalls === 1) return { content: "", toolCalls: [{ id: "big", name: "big", arguments: {} }] };
        secondCharacters = request.messages.reduce((total, message) => total + message.content.length, 0);
        return { content: "done", toolCalls: [] };
      },
    });
    agent.register({
      name: "big",
      description: "Return a large result.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      parseInput: value => value as Record<string, unknown>,
      assessRisk: () => ({ kind: "safe", reason: "probe" }),
      execute: () => "X".repeat(50_000),
    });
    await agent.run("read everything");
    expect(summaries).toBeGreaterThan(0);
    expect(modelCalls).toBe(2);
    expect(secondCharacters).toBeLessThan(50_000);
    expect(session.all().some(event => event.type === "session/compaction")).toBe(true);
    session.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
