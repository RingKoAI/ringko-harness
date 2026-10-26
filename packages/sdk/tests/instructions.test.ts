import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INSTRUCTION_LIMITS } from "@ringko-ai/config";
import { recordSessionCompaction, SessionStore, toChatMessages } from "@ringko-ai/session";
import { createRingKo, defineTool, type ChatMessage } from "../src/index.ts";
import { RUNTIME_INSTRUCTIONS_PREFIX } from "../src/instructions.ts";
import { RuntimeManager } from "../src/runtime.ts";

async function isolated(test: (workspace: string) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "ringko-instructions-"));
  const previousHome = process.env.RINGKO_HOME, previousAgents = process.env.AGENTS_HOME;
  process.env.RINGKO_HOME = join(root, "home"); process.env.AGENTS_HOME = join(root, "agents");
  const workspace = join(root, "project"); mkdirSync(join(workspace, ".git"), { recursive: true });
  try { await test(workspace); }
  finally {
    if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
    if (previousAgents === undefined) delete process.env.AGENTS_HOME; else process.env.AGENTS_HOME = previousAgents;
    rmSync(root, { recursive: true, force: true });
  }
}
function rules(messages: readonly ChatMessage[]) {
  return messages.filter(message => message.role === "system" && message.content.startsWith(RUNTIME_INSTRUCTIONS_PREFIX));
}
function history(): ChatMessage[] {
  return Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: "Earlier work ".repeat(500) }));
}

it("reloads rules between tool steps and replaces old blocks without removing other system messages", async () => isolated(async workspace => {
  const file = join(workspace, "AGENTS.md"); writeFileSync(file, "Original project rules");
  const runtime = new RuntimeManager(workspace);
  let calls = 0;
  const managed = runtime.createAgent({}, {
    instructions: "Fixed host guidance",
    history: [{ role: "system", content: `${RUNTIME_INSTRUCTIONS_PREFIX}Stale rules` }, { role: "system", content: "Other host system context" }],
    model: async request => {
      const blocks = rules(request.messages);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].content).toContain("Fixed host guidance");
      expect(blocks[0].content).not.toContain("Stale rules");
      expect(request.messages.some(message => message.content === "Other host system context")).toBe(true);
      if (++calls === 1) {
        expect(blocks[0].content).toContain("Original project rules");
        return { content: "", toolCalls: [{ id: "edit-rules", name: "edit_rules", arguments: {} }] };
      }
      expect(blocks[0].content).toContain("Updated project rules");
      expect(blocks[0].content).not.toContain("Original project rules");
      return { content: "done", toolCalls: [] };
    },
  });
  managed.agent.register(defineTool({ name: "edit_rules", description: "Fixture", inputSchema: { type: "object" }, parseInput: () => ({}), assessRisk: () => ({ kind: "safe", reason: "Fixture" }), execute: () => { writeFileSync(file, "Updated project rules"); return "updated"; } }));
  try { await managed.agent.run("Apply the new rules"); expect(calls).toBe(2); expect(rules(managed.agent.history)).toHaveLength(1); }
  finally { managed.close(); await runtime.close(); }
}));

for (const automatic of [false, true]) {
  it(`rebuilds rules after ${automatic ? "automatic" : "manual"} compaction, including changes made during summarization`, async () => isolated(async workspace => {
    const file = join(workspace, "AGENTS.md"); writeFileSync(file, "Rules before summary");
    const runtime = new RuntimeManager(workspace);
    let summaries = 0, calls = 0;
    const managed = runtime.createAgent({}, {
      history: [{ role: "system", content: `${RUNTIME_INSTRUCTIONS_PREFIX}Stale saved rules` }, ...history()],
      contextWindow: 8192, reserveOutputTokens: 1024, compaction: { keepRecent: 2, margin: 0 },
      smallModel: async request => {
        summaries++;
        expect(rules(request.messages)).toHaveLength(0);
        writeFileSync(file, "Rules changed during summary");
        return { content: "Preserved work summary", toolCalls: [] };
      },
      model: async request => {
        calls++;
        expect(rules(request.messages)).toHaveLength(1);
        expect(rules(request.messages)[0].content).toContain("Rules changed during summary");
        expect(rules(request.messages)[0].content).not.toContain("Stale saved rules");
        expect(request.messages.some(message => message.content.includes("Preserved work summary"))).toBe(true);
        return { content: "done", toolCalls: [] };
      },
    });
    try {
      if (!automatic) expect((await managed.agent.compact()).compacted).toBe(true);
      await managed.agent.run("Continue after compaction");
      expect(summaries).toBe(1); expect(calls).toBe(1);
    } finally { managed.close(); await runtime.close(); }
  }));
}

it("restores fresh rules from disk when replay history contains only a saved summary", async () => isolated(async workspace => {
  writeFileSync(join(workspace, "AGENTS.md"), "Current disk rules");
  const session = new SessionStore({ root: join(workspace, "sessions") }).create();
  recordSessionCompaction(session, "Summary without ambient instructions"); session.flush();
  const runtime = new RuntimeManager(workspace);
  const managed = runtime.createAgent({}, { session, history: toChatMessages(session.all()), model: async request => {
    expect(rules(request.messages)).toHaveLength(1);
    expect(rules(request.messages)[0].content).toContain("Current disk rules");
    expect(request.messages.some(message => message.content === "Summary without ambient instructions")).toBe(true);
    return { content: "restored", toolCalls: [] };
  } });
  try { expect((await managed.agent.run("Resume")).content).toBe("restored"); }
  finally { managed.close(); await runtime.close(); session.close(); }
}));

it("withdraws deleted rules and blocks provider requests on oversized replacement files", async () => isolated(async workspace => {
  const file = join(workspace, "AGENTS.md"); writeFileSync(file, "Initial rules");
  const runtime = new RuntimeManager(workspace);
  let calls = 0;
  const managed = runtime.createAgent({}, { model: async request => {
    calls++;
    expect(rules(request.messages)).toHaveLength(calls === 1 ? 1 : 0);
    return { content: "done", toolCalls: [] };
  } });
  try {
    await managed.agent.run("First"); rmSync(file);
    await managed.agent.run("Rules removed");
    writeFileSync(file, "x".repeat(INSTRUCTION_LIMITS.fileBytes + 1));
    await expect(managed.agent.run("Must not ignore unreadable rules")).rejects.toThrow("Instruction file exceeds");
    expect(calls).toBe(2);
  } finally { managed.close(); await runtime.close(); }
}));

it("keeps fixed SDK instructions after compaction even when a summary system message exists", async () => {
  const agent = createRingKo({ instructions: "Fixed SDK policy", history: history(), compaction: { keepRecent: 2 }, smallModel: async () => ({ content: "Summary", toolCalls: [] }), model: async request => {
    expect(rules(request.messages)).toHaveLength(1);
    expect(rules(request.messages)[0].content).toContain("Fixed SDK policy");
    return { content: "done", toolCalls: [] };
  } });
  await agent.compact(); await agent.run("Continue");
});

it("reestimates the compaction budget when rules change instead of reusing earlier provider token counts", async () => isolated(async workspace => {
  const file = join(workspace, "AGENTS.md"); writeFileSync(file, "Short rules");
  const runtime = new RuntimeManager(workspace);
  let summaries = 0;
  const managed = runtime.createAgent({}, {
    history: Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: "Earlier work" })),
    contextWindow: 20_000, reserveOutputTokens: 1024, compaction: { keepRecent: 2, margin: 0, ratio: 0.5 },
    smallModel: async () => { summaries++; return { content: "Budget summary", toolCalls: [] }; },
    model: async () => ({ content: "done", toolCalls: [], usage: { inputTokens: 10, outputTokens: 1 } }),
  });
  try {
    await managed.agent.run("First"); expect(summaries).toBe(0);
    writeFileSync(file, "Updated rules ".repeat(4000));
    await managed.agent.run("Second"); expect(summaries).toBe(1);
  } finally { managed.close(); await runtime.close(); }
}));

it("cancels a pending rule resolver without calling the provider", async () => {
  let started!: () => void, release!: (text: string) => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<string>(resolve => { release = resolve; });
  let calls = 0;
  const agent = createRingKo({ resolveInstructions: () => { started(); return pending; }, model: async () => { calls++; return { content: "done", toolCalls: [] }; } });
  const controller = new AbortController();
  const run = agent.run("Wait", { signal: controller.signal });
  await entered; controller.abort();
  try { await expect(run).rejects.toThrow(); expect(calls).toBe(0); }
  finally { release("Late instructions"); }
});

it("rejects overlapping run and compaction operations instead of losing rebuilt history", async () => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const agent = createRingKo({
    history: history(), instructions: "Host rules", compaction: { keepRecent: 2 },
    smallModel: async () => { entered(); await pending; return { content: "Retained summary", toolCalls: [] }; },
    model: async () => ({ content: "done", toolCalls: [] }),
  });
  const compaction = agent.compact();
  await started;
  try {
    await expect(agent.run("Must wait")).rejects.toThrow("active run or compaction");
    await expect(agent.compact()).rejects.toThrow("compaction is active");
  } finally { release(); }
  expect((await compaction).compacted).toBe(true);
  expect((await agent.run("Continue")).content).toBe("done");
  expect(agent.history.some(message => message.content.includes("Retained summary"))).toBe(true);
});
