import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "@ringko-ai/session";
import { recordAssistantMessage, sessionUsage, toChatMessages } from "@ringko-ai/session";
import { createRingKo, type ModelClient, type ToolDefinition } from "../src/index.ts";

const echo: ToolDefinition<{ text: string }, string> = {
  name: "echo",
  description: "Return the given text.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
  parseInput(value) {
    if (typeof value !== "object" || value === null || !("text" in value) || typeof value.text !== "string") {
      throw new TypeError("Expected text.");
    }
    return { text: value.text };
  },
  assessRisk: () => ({ kind: "safe", reason: "Echo is safe." }),
  execute: ({ text }) => text,
};

describe("RingKo SDK facade", () => {
  it("exposes the access mode", () => {
    const ringko = createRingKo({ model: async () => ({ content: "ok", toolCalls: [] }) });
    expect(ringko.access.id).toBe("approval");
  });

  it("runs a tool call and returns the final turn", async () => {
    const model: ModelClient = async (request) => {
      if (request.messages.some((message) => message.role === "tool")) {
        return { content: "done", toolCalls: [] };
      }
      return { content: "", toolCalls: [{ id: "call-1", name: "echo", arguments: { text: "hi" } }] };
    };
    const ringko = createRingKo({ model });
    ringko.register(echo);

    const result = await ringko.run("go");

    expect(result.content).toBe("done");
    expect(result.turns).toBe(2);
  });

  it("persists the call before the tool executes", async () => {
    const root = mkdtempSync(join(tmpdir(), "ringko-call-log-"));
    try {
      const store = new SessionStore({ root });
      const session = store.create();
      const ringko = createRingKo({
        session,
        model: async ({ messages }) => messages.some((message) => message.role === "tool")
          ? { content: "done", toolCalls: [] }
          : { content: "", toolCalls: [{ id: "c1", name: "echo", arguments: { text: "ok" } }] },
      });
      ringko.register({
        ...echo,
        async execute(input) {
          const saved = store.open(session.id, "read").all();
          expect(saved.map((event) => event.type)).toEqual([
            "run/started", "user/message", "assistant/message", "tool/call",
          ]);
          return input.text;
        },
      });
      await ringko.run("run");
      session.close();
      expect(store.open(session.id, "read").all().map((event) => event.type)).toEqual([
        "run/started",
        "user/message",
        "session/instructions",
        "assistant/message",
        "tool/call",
        "tool/result",
        "assistant/message",
        "run/completed",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("settles a failed run as failed and releases the run guard", async () => {
    const root = mkdtempSync(join(tmpdir(), "ringko-run-failed-"));
    try {
      const store = new SessionStore({ root });
      const session = store.create();
      const ringko = createRingKo({ session, model: async () => { throw new Error("fixture model failure"); } });
      await expect(ringko.run("fail")).rejects.toThrow("fixture model failure");
      const events = store.open(session.id, "read").all();
      expect(events.some(event => event.type === "run/failed" && (event.data as { status?: string }).status === "failed")).toBe(true);
      expect(events.some(event => event.type === "run/completed")).toBe(false);
      await expect(ringko.run("again")).rejects.toThrow("fixture model failure");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("distinguishes cancellation from failure", async () => {
    const root = mkdtempSync(join(tmpdir(), "ringko-run-cancelled-"));
    try {
      const store = new SessionStore({ root });
      const session = store.create();
      const ringko = createRingKo({ session, model: async () => ({ content: "ok", toolCalls: [] }) });
      const controller = new AbortController();
      controller.abort();
      await expect(ringko.run("cancel", { signal: controller.signal })).rejects.toThrow();
      const events = store.open(session.id, "read").all();
      expect(events.some(event => event.type === "run/cancelled" && (event.data as { status?: string }).status === "cancelled")).toBe(true);
      expect(events.some(event => event.type === "run/failed")).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs cleanup and resets the guard when terminal persistence fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "ringko-run-persist-"));
    try {
      const store = new SessionStore({ root });
      const session = store.create();
      const original = session.appendEvent.bind(session);
      let failed = false;
      session.appendEvent = ((type: string, data?: unknown, options?: { time?: number; ignorable?: boolean }) => {
        if (!failed && type === "run/completed") {
          failed = true;
          throw new Error("fixture persistence failure");
        }
        return original(type, data, options);
      }) as typeof session.appendEvent;
      const ringko = createRingKo({ session, model: async () => ({ content: "ok", toolCalls: [] }) });
      await expect(ringko.run("one")).rejects.toThrow("fixture persistence failure");
      expect(await ringko.run("two")).toMatchObject({ content: "ok" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("repairs an interrupted call before the next model request", async () => {
    const root = mkdtempSync(join(tmpdir(), "ringko-call-repair-"));
    try {
      const store = new SessionStore({ root });
      const interrupted = store.create();
      recordAssistantMessage(interrupted, 1, "", [{ id: "c1", name: "echo", arguments: { text: "x" } }]);
      interrupted.close();
      const session = store.open(interrupted.id, "write");
      const prior = toChatMessages(session.all());
      const ringko = createRingKo({
        session,
        history: prior,
        model: async ({ messages }) => {
          expect(messages[0]).toMatchObject({ role: "assistant", toolCalls: [{ id: "c1" }] });
          expect(messages[1]).toMatchObject({ role: "tool", toolCallId: "c1" });
          expect(messages[1]?.content).toContain("not started before the run was interrupted.");
          expect(store.open(session.id, "read").all()[1]?.type).toBe("tool/result");
          return { content: "safe", toolCalls: [] };
        },
      });
      await ringko.run("continue");
      session.close();
      expect(store.open(interrupted.id, "read").all().filter((event) => event.type === "tool/result")).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("records cleanup failure instead of a successful terminal state", async () => {
    const root = mkdtempSync(join(tmpdir(), "ringko-cleanup-failed-"));
    const session = new SessionStore({ root }).create();
    try {
      const ringko = createRingKo({ session, model: async () => ({ content: "ok", toolCalls: [] }) });
      const settle = ringko.jobs.settle.bind(ringko.jobs);
      ringko.jobs.settle = async () => { throw new Error("fixture cleanup failure"); };
      await expect(ringko.run("one")).rejects.toThrow("fixture cleanup failure");
      expect(session.all().filter(event => event.type.startsWith("run/")).map(event => event.type)).toEqual(["run/started", "run/failed"]);
      ringko.jobs.settle = settle;
      expect((await ringko.run("two")).content).toBe("ok");
    } finally { session.close(); rmSync(root, { recursive: true, force: true }); }
  });

  it("preserves undefined model rejections", async () => {
    const ringko = createRingKo({ model: async () => { throw undefined; } });
    const result = await ringko.run("fail").then(() => ({ rejected: false, error: undefined as unknown }), error => ({ rejected: true, error }));
    expect(result).toEqual({ rejected: true, error: undefined });
  });

  it("retains the primary error and attaches cleanup failures", async () => {
    const primary = new Error("fixture model failure");
    const cleanup = new Error("fixture cleanup failure");
    const ringko = createRingKo({ model: async () => { throw primary; } });
    ringko.jobs.cancelAll = () => { throw cleanup; };
    let settled = false;
    ringko.jobs.settle = async () => { settled = true; };
    const result = await ringko.run("fail").catch(error => error);
    expect(result).toBe(primary);
    expect(result.cleanupErrors).toEqual([cleanup]);
    expect(settled).toBe(true);
  });

  it("does not append contradictory terminal events after a failed flush", async () => {
    const root = mkdtempSync(join(tmpdir(), "ringko-terminal-flush-"));
    const session = new SessionStore({ root }).create();
    const flush = session.flush.bind(session);
    try {
      let injected = false;
      session.flush = () => {
        if (!injected && session.all().at(-1)?.type === "run/completed") {
          injected = true;
          throw new Error("fixture terminal flush");
        }
        flush();
      };
      const ringko = createRingKo({ session, model: async () => ({ content: "ok", toolCalls: [] }) });
      await expect(ringko.run("one")).rejects.toThrow("fixture terminal flush");
      expect(session.all().filter(event => event.type.startsWith("run/")).map(event => event.type)).toEqual(["run/started", "run/completed"]);
      expect((await ringko.run("two")).content).toBe("ok");
    } finally { session.flush = flush; session.close(); rmSync(root, { recursive: true, force: true }); }
  });

  it("rejects a missing model client", () => {
    expect(() => createRingKo({ model: undefined as unknown as ModelClient })).toThrow(
      "RingKo requires a model client.",
    );
  });

  it("records primary and alternate delegated-model usage exactly once in the same session", async () => {
    const root = mkdtempSync(join(tmpdir(), "ringko-session-usage-"));
    const previous = process.env.RINGKO_HOME; process.env.RINGKO_HOME = root;
    try {
      const store = new SessionStore({ root: join(root, "sessions") });
      const session = store.create();
      let turns = 0;
      const ringko = createRingKo({
        session, task: true, modelId: "parent", taskModels: ["Fixture/child"],
        resolveTaskModel: async () => async () => ({ content: "child result", toolCalls: [], usage: { inputTokens: 30, outputTokens: 5, cacheReadTokens: 15 } }),
        model: async () => ++turns === 1
          ? { content: "", toolCalls: [{ id: "delegate", name: "task", arguments: { description: "Inspect", prompt: "Inspect", mode: "read", model: "Fixture/child" } }], usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 5 } }
          : { content: "done", toolCalls: [], usage: { inputTokens: 20, outputTokens: 3, cacheReadTokens: 10 } },
      });
      await ringko.run("Delegate inspection");
      session.close();
      const events = store.open(session.id, "read").all();
      expect(events.filter(event => event.type === "model/usage")).toHaveLength(3);
      expect(sessionUsage(events)).toMatchObject({ calls: 3, inputTokens: 60, outputTokens: 10, totalTokens: 70, cacheReadTokens: 30, cacheHitRate: 0.5 });
    } finally {
      if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
