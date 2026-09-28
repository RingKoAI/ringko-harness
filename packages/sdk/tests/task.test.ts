import { describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolRegistry, defineTool, type ModelClient } from "@ringko-ai/harness";
import { registerWorkspaceTools } from "../../tools/src/index.ts";
import { TaskManager, TASK_LIMITS, type TaskEvent } from "../src/task.ts";
import { createRingKo } from "../src/index.ts";

const input = { description: "Inspect files", prompt: "child task", mode: "read" };
const final = { content: "finished", toolCalls: [] };

describe("delegated task capability boundary", () => {
  it("exposes only read capabilities and refuses malicious write, shell and recursive calls", async () => {
    const root = mkdtempSync(join(tmpdir(), "rkh-task-"));
    try {
      const tools = new ToolRegistry();
      registerWorkspaceTools(tools, { workspace: root });
      let calls = 0;
      const model: ModelClient = async request => {
        expect(request.tools.map(tool => tool.name).sort()).toEqual(["glob", "grep", "read"]);
        if (calls++ === 0) return { content: "", toolCalls: [
          { id: "w", name: "write", arguments: { path: "blocked.txt", content: "bad" } },
          { id: "s", name: "shell", arguments: { command: "bad" } },
          { id: "t", name: "task", arguments: { ...input, mode: "write" } },
        ] };
        expect(request.messages.filter(message => message.role === "tool").every(message => message.content.includes("No tool is registered"))).toBe(true);
        return final;
      };
      const manager = new TaskManager({ model, tools });
      tools.register(manager.tool());
      await tools.call("task", input, undefined, "full");
      expect(await Bun.file(join(root, "blocked.txt")).exists()).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("forwards external writes through the parent approval and parser before touching disk", async () => {
    const root = mkdtempSync(join(tmpdir(), "rkh-task-"));
    try {
      writeFileSync(join(root, "existing.txt"), "original");
      for (const allowed of [false, true]) {
        const tools = new ToolRegistry();
        registerWorkspaceTools(tools, { workspace: join(root, "workspace") });
        let calls = 0;
        const manager = new TaskManager({ tools, model: async request => {
          expect(request.tools.map(tool => tool.name).sort()).toEqual(["edit", "glob", "grep", "read", "write"]);
          return calls++ === 0 ? { content: "", toolCalls: [{ id: "overwrite", name: "write", arguments: { path: join(root, "existing.txt"), content: "updated" } }] } : final;
        } });
        tools.register(manager.tool());
        let approvals = 0;
        await tools.call("task", { ...input, mode: "write" }, async request => {
          approvals++;
          expect(request.toolName).toBe("write");
          return allowed;
        }, "approval");
        expect(approvals).toBe(1);
        expect(readFileSync(join(root, "existing.txt"), "utf8")).toBe(allowed ? "updated" : "original");
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("isolates parent history and correlates child events without merging child messages", async () => {
    const events: TaskEvent[] = [];
    const ringko = createRingKo({ task: true, compaction: { enabled: false }, history: [{ role: "user", content: "parent secret" }], onTaskEvent: event => events.push(event), model: async request => {
      if (request.messages.some(message => message.content === "child task")) {
        expect(request.messages.some(message => message.content === "parent secret")).toBe(false);
        return { content: "child answer", toolCalls: [] };
      }
      return request.messages.some(message => message.role === "tool") ? final : { content: "", toolCalls: [{ id: "parent-call", name: "task", arguments: input }] };
    } });
    await ringko.run("delegate");
    expect(events.map(event => event.type)).toEqual(["started", "event", "completed"]);
    expect(new Set(events.map(event => event.taskId)).size).toBe(1);
    expect(events.every(event => event.parentCallId === "parent-call")).toBe(true);
    expect(ringko.history.some(message => message.role === "assistant" && message.content === "child answer")).toBe(false);
  });

  it("cancels a provider that ignores abort and releases its active slot", async () => {
    const controller = new AbortController();
    const events: TaskEvent[] = [];
    let finish!: (value: typeof final) => void;
    const tools = new ToolRegistry();
    const manager = new TaskManager({ tools, onEvent: event => events.push(event), model: () => new Promise(resolve => { finish = resolve; }) });
    tools.register(manager.tool());
    const pending = tools.call("task", input, undefined, "approval", { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toThrow("parent_cancelled");
    expect(events.at(-1)?.type).toBe("cancelled");
    expect(() => manager.resetRun()).not.toThrow();
    finish(final);
    await Promise.resolve();
    expect(events.some(event => event.type === "completed")).toBe(false);
  });

  it("rejects malformed mode and oversized input before launching a model", async () => {
    let calls = 0;
    const tools = new ToolRegistry();
    tools.register(new TaskManager({ tools, model: async () => { calls++; return final; } }).tool());
    for (const value of [{ ...input, mode: "admin" }, { ...input, shell: true }, { ...input, prompt: "x".repeat(TASK_LIMITS.promptCharacters + 1) }, { ...input, prompt: " " }]) {
      await expect(tools.call("task", value)).rejects.toBeInstanceOf(TypeError);
    }
    expect(calls).toBe(0);
  });

  it("records deadline cancellation and frees its budget reservation", async () => {
    let deadline!: () => void;
    const originalTimer = globalThis.setTimeout;
    const timer = spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, milliseconds: number) => {
      if (milliseconds === TASK_LIMITS.timeoutMs) deadline = callback;
      return originalTimer(callback, milliseconds);
    }) as typeof setTimeout);
    const tools = new ToolRegistry();
    const events: TaskEvent[] = [];
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const manager = new TaskManager({ tools, onEvent: event => { events.push(event); if (event.type === "started") started(); }, model: () => new Promise(() => {}) });
    tools.register(manager.tool());
    try {
      const pending = tools.call("task", input);
      await ready;
      timer.mockRestore();
      deadline();
      await expect(pending).rejects.toThrow("timeout");
      expect(events.at(-1)).toMatchObject({ type: "cancelled", reason: "timeout" });
      expect(() => manager.resetRun()).not.toThrow();
    } finally { timer.mockRestore(); }
  });

  it("cancels a pending child approval without executing the write", async () => {
    let executed = false;
    let requested!: () => void;
    const ready = new Promise<void>(resolve => { requested = resolve; });
    const tools = new ToolRegistry();
    tools.register(defineTool({ name: "write", taskAccess: "write", description: "Fixture", inputSchema: { type: "object" }, parseInput: value => value, assessRisk: () => ({ kind: "external_file", level: "high", reason: "Overwrite" }), execute: () => { executed = true; return "bad"; } }));
    tools.register(new TaskManager({ tools, model: async () => ({ content: "", toolCalls: [{ id: "pending", name: "write", arguments: {} }] }) }).tool());
    const controller = new AbortController();
    const pending = tools.call("task", { ...input, mode: "write" }, request => {
      expect(request.signal).toBeDefined();
      requested();
      return new Promise(() => {});
    }, "approval", { signal: controller.signal });
    await ready;
    controller.abort();
    await expect(pending).rejects.toThrow("parent_cancelled");
    expect(executed).toBe(false);
  });

  it("enforces synchronous concurrency reservations and recovers after event persistence fails", async () => {
    const tools = new ToolRegistry();
    const controller = new AbortController();
    const manager = new TaskManager({ tools, model: () => new Promise(() => {}) });
    tools.register(manager.tool());
    const first = tools.call("task", input, undefined, "approval", { signal: controller.signal });
    const second = tools.call("task", input, undefined, "approval", { signal: controller.signal });
    await expect(tools.call("task", input)).rejects.toThrow("concurrency limit");
    expect(() => manager.resetRun()).toThrow("tasks are running");
    const settled = Promise.allSettled([first, second]);
    controller.abort();
    for (const result of await settled) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") expect(String(result.reason)).toContain("cancelled");
    }
    manager.resetRun();
    const failed = new ToolRegistry();
    let calls = 0;
    const broken = new TaskManager({ tools: failed, model: async () => { calls++; return final; }, onEvent: () => { throw new Error("Disk full"); } });
    failed.register(broken.tool());
    await expect(failed.call("task", input)).rejects.toThrow();
    expect(calls).toBe(0);
    expect(() => broken.resetRun()).not.toThrow();
  });

  it("bounds launches, model turns and final results", async () => {
    const tools = new ToolRegistry();
    const manager = new TaskManager({ tools, model: async () => ({ content: "x".repeat(TASK_LIMITS.resultCharacters + 1), toolCalls: [] }) });
    tools.register(manager.tool());
    for (let index = 0; index < TASK_LIMITS.maxPerRun; index++) {
      const result = await tools.call("task", input) as { content: string; truncated: boolean };
      expect(result.content.length).toBe(TASK_LIMITS.resultCharacters);
      expect(result.truncated).toBe(true);
    }
    await expect(tools.call("task", input)).rejects.toThrow("budget exhausted");
    manager.resetRun();
    await expect(tools.call("task", input)).resolves.toBeDefined();
    const looping = new ToolRegistry();
    looping.register(defineTool({ name: "read", taskAccess: "read", description: "Fixture", inputSchema: { type: "object" }, parseInput: value => value, assessRisk: () => ({ kind: "safe", reason: "Fixture" }), execute: () => "ok" }));
    looping.register(new TaskManager({ tools: looping, model: async () => ({ content: "", toolCalls: [{ id: "loop", name: "read", arguments: {} }] }) }).tool());
    await expect(looping.call("task", input)).rejects.toThrow("turn_limit");
  });
});
