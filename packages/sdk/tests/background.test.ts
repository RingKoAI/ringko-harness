import { expect, it } from "bun:test";
import { defineTool } from "@ringko-ai/harness";
import { createRingKo } from "../src/index.ts";

it("runs a specified child model in background and resumes the parent with the result", async () => {
  let complete!: (value: { content: string; toolCalls: [] }) => void;
  let parentPaused!: () => void;
  const ready = new Promise<void>(resolve => { parentPaused = resolve; });
  let parentTurns = 0, resolved = "";
  const ringko = createRingKo({ task: true, compaction: { enabled: false }, taskModels: ["test/child"], resolveTaskModel: async id => {
    resolved = id;
    return request => {
      expect(request.messages.some(message => message.content === "parent secret")).toBe(false);
      return new Promise(resolve => { complete = resolve; });
    };
  }, history: [{ role: "user", content: "parent secret" }], model: async request => {
    parentTurns++;
    if (parentTurns === 1) return { content: "", toolCalls: [{ id: "delegate", name: "task", arguments: { description: "Inspect", prompt: "child", mode: "read", model: "test/child", background: true } }] };
    if (parentTurns === 2) { expect(request.messages.at(-1)?.content).toContain('"jobId"'); parentPaused(); return { content: "Working on other things", toolCalls: [] }; }
    expect(request.messages.at(-1)?.role).toBe("system");
    expect(request.messages.at(-1)?.content).toContain("child findings");
    return { content: "Reviewed child findings", toolCalls: [] };
  } });
  const pending = ringko.run("delegate");
  await ready;
  complete({ content: "child findings", toolCalls: [] });
  expect((await pending).content).toBe("Reviewed child findings");
  expect(resolved).toBe("test/child");
  expect(parentTurns).toBe(3);
  expect(ringko.jobs.list()).toMatchObject([{ kind: "sub", status: "completed", background: true }]);
  expect(ringko.history.filter(message => message.role === "user").map(message => message.content)).toEqual(["parent secret", "delegate"]);
});

it("converts a running foreground child to background and then resumes automatically", async () => {
  let complete!: (value: { content: string; toolCalls: [] }) => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let returned!: () => void;
  const detached = new Promise<void>(resolve => { returned = resolve; });
  let turns = 0;
  const ringko = createRingKo({ task: true, taskModels: ["test/child"], resolveTaskModel: async () => () => new Promise(resolve => { complete = resolve; started(); }), model: async () => {
    if (++turns === 1) return { content: "", toolCalls: [{ id: "foreground", name: "task", arguments: { description: "Inspect", prompt: "child", mode: "read", model: "test/child" } }] };
    if (turns === 2) returned();
    return { content: "done", toolCalls: [] };
  } });
  const pending = ringko.run("delegate"); await ready;
  ringko.jobs.detach(ringko.jobs.list()[0].jobId);
  await detached;
  complete({ content: "result", toolCalls: [] });
  await pending;
  expect(turns).toBe(3);
});

it("auto-approves workspace writes and full mode executes configured shell capabilities", async () => {
  for (const mode of ["write", "full"] as const) {
    let executed = false, childTurns = 0;
    const name = mode === "write" ? "write" : "shell";
    let turns = 0;
    const ringko = createRingKo({ task: true, taskModels: ["test/child"], resolveTaskModel: async () => async request => {
      expect(request.tools.some(tool => tool.name === name)).toBe(true);
      return ++childTurns === 1 ? { content: "", toolCalls: [{ id: "action", name, arguments: {} }] } : { content: "child done", toolCalls: [] };
    }, requestApproval: async () => { throw new Error("Should not ask for this authorized operation"); }, model: async () => ++turns === 1 ? { content: "", toolCalls: [{ id: "delegate", name: "task", arguments: { description: "Work", prompt: "child", mode, model: "test/child" } }] } : { content: "done", toolCalls: [] } });
    ringko.register(defineTool({ name, taskAccess: mode === "write" ? "write" : undefined, description: "Fixture", inputSchema: { type: "object" }, parseInput: value => value, assessRisk: () => ({ kind: mode === "write" ? "workspace_write" : "shell", level: "high", reason: "Fixture" }), execute: () => { executed = true; return "ok"; } }));
    await ringko.run("delegate"); expect(executed).toBe(true);
  }
});

it("fails a nonconfigured model without silently selecting a different provider", async () => {
  let resolved = false;
  const ringko = createRingKo({ task: true, taskModels: ["test/child"], resolveTaskModel: async () => { resolved = true; return async () => ({ content: "", toolCalls: [] }); }, model: async () => ({ content: "", toolCalls: [] }) });
  await expect(ringko.tools.call("task", { description: "Inspect", prompt: "child", mode: "read", model: "malicious/model" })).rejects.toThrow("not configured");
  expect(resolved).toBe(false);
});
