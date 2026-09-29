import { expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineTool } from "@ringko-ai/harness";
import { PermissionManager } from "../src/permissions.ts";
import { RuntimeManager } from "../src/runtime.ts";

async function isolated(test: (root: string) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "ringko-permissions-"));
  const previous = process.env.RINGKO_HOME;
  process.env.RINGKO_HOME = root;
  try { await test(root); } finally {
    if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

it("prioritizes deny and ask over allow and isolates targets and sessions", async () => isolated(async root => {
  const manager = new PermissionManager(root);
  manager.add("one", { tool: "shell", target: "echo hello", behavior: "allow" }, "session");
  expect(manager.decide("one", "shell", "echo hello")).toBe("allow");
  expect(manager.decide("two", "shell", "echo hello")).toBe("default");
  expect(manager.decide("one", "shell", "echo other")).toBe("default");
  manager.add("one", { tool: "shell", behavior: "ask" }, "session");
  expect(manager.decide("one", "shell", "echo hello")).toBe("ask");
  manager.add("one", { tool: "shell", behavior: "deny" }, "session");
  expect(manager.decide("one", "shell", "echo hello")).toBe("deny");
}));

it("persists workspace rules and fails closed on corrupted policy", async () => isolated(async root => {
  const manager = new PermissionManager(root);
  manager.add("one", { tool: "browser__navigate", target: "browser/navigate", behavior: "allow" }, "saved");
  expect(new PermissionManager(root).decide("two", "browser__navigate", "browser/navigate")).toBe("allow");
  expect(new PermissionManager(join(root, "other")).decide("two", "browser__navigate", "browser/navigate")).toBe("default");
  writeFileSync(manager.path, "invalid");
  expect(() => manager.decide("one", "safe")).toThrow();
}));

it("never executes a denied tool in full mode and forces explicit ask for safe tools", async () => isolated(async root => {
  const runtime = new RuntimeManager(root);
  let executed = 0;
  const managed = runtime.createAgent({ permission: "full" }, { model: async () => ({ content: "", toolCalls: [] }) });
  managed.agent.register(defineTool({ name: "fixture", description: "Fixture", inputSchema: { type: "object" }, parseInput: () => ({}), assessRisk: () => ({ kind: "safe", reason: "Fixture" }), execute: () => { executed++; return "done"; } }));
  const session = "explicit";
  managed.agent.tools.setPermissionCheck(async request => runtime.permissions.decide(session, request.toolName));
  try {
    runtime.permissions.add(session, { tool: "fixture", behavior: "ask" }, "session");
    await expect(managed.agent.tools.call("fixture", {}, undefined, "full")).rejects.toThrow();
    let asked = false;
    expect(await managed.agent.tools.call("fixture", {}, async request => { asked = request.ruleRequired === true; return true; }, "full")).toBe("done");
    expect(asked).toBe(true);
    runtime.permissions.add(session, { tool: "fixture", behavior: "deny" }, "session");
    await expect(managed.agent.tools.call("fixture", {}, async () => true, "full")).rejects.toThrow();
    expect(executed).toBe(1);
  } finally { await runtime.close(); }
}));

it("remembers only successful approvals and rejects revoked or aborted approval", async () => isolated(async root => {
  const manager = new PermissionManager(root);
  const request = { toolName: "shell", target: "echo hello", riskKind: "shell" as const, riskLevel: "high" as const, reason: "test" };
  const handler = manager.approval("one", async pending => { pending.remember?.("session"); return true; })!;
  expect(await handler(request)).toBe(true);
  expect(manager.decide("one", "shell", "echo hello")).toBe("allow");
  const controller = new AbortController();
  const aborting = manager.approval("two", async pending => { pending.remember?.("saved"); controller.abort(); return true; })!;
  await expect(aborting({ ...request, signal: controller.signal })).rejects.toThrow();
  expect(manager.decide("two", "shell", "echo hello")).toBe("default");
  const revoked = manager.approval("three", async () => { manager.add("three", { tool: "shell", behavior: "deny" }, "session"); return true; })!;
  expect(await revoked(request)).toBe(false);
}));

it("preserves saved policy after lock contention and oversized updates", async () => isolated(async root => {
  const manager = new PermissionManager(root);
  manager.add("one", { tool: "fixture", target: "initial", behavior: "allow" }, "saved");
  writeFileSync(`${manager.path}.lock`, "locked");
  expect(() => manager.add("one", { tool: "fixture", behavior: "deny" }, "saved")).toThrow("locked");
  rmSync(`${manager.path}.lock`);
  for (let index = 0; index < 30; index++) manager.add("one", { tool: "fixture", target: `${index}:${"x".repeat(8000)}`, behavior: "allow" }, "saved");
  expect(() => {
    for (let index = 30; index < 40; index++) manager.add("one", { tool: "fixture", target: `${index}:${"x".repeat(8000)}`, behavior: "allow" }, "saved");
  }).toThrow("256 KiB");
  expect(manager.decide("one", "fixture", "initial")).toBe("allow");
  manager.add("one", { tool: "fixture", target: "small", behavior: "deny" }, "saved");
  expect(manager.decide("one", "fixture", "small")).toBe("deny");
}));

it("remembers an actual runtime approval for the same target and shares saved rules across agents", async () => isolated(async root => {
  const runtime = new RuntimeManager(root);
  let approvals = 0;
  let executions = 0;
  let target = "one";
  const makeAgent = () => runtime.createAgent({ permission: "approval" }, {
    model: async request => request.messages.at(-1)?.role === "tool"
      ? { content: "done", toolCalls: [] }
      : { content: "", toolCalls: [{ id: crypto.randomUUID(), name: "fixture", arguments: { target } }] },
    requestApproval: async request => { approvals++; request.remember?.("saved"); return true; },
  });
  const first = makeAgent();
  const second = makeAgent();
  for (const managed of [first, second]) managed.agent.register(defineTool({
    name: "fixture", description: "Fixture", inputSchema: { type: "object" },
    parseInput: value => value as { target: string },
    assessRisk: input => ({ kind: "shell", reason: "Fixture", target: input.target }),
    execute: () => { executions++; return "done"; },
  }));
  try {
    expect((await first.agent.run("first")).content).toBe("done");
    expect((await first.agent.run("again")).content).toBe("done");
    expect((await second.agent.run("shared")).content).toBe("done");
    expect(approvals).toBe(1);
    target = "two";
    expect((await second.agent.run("different target")).content).toBe("done");
    expect(approvals).toBe(2);
    expect(executions).toBe(4);
    expect(runtime.permissions.remove("", { tool: "fixture", target: "one", behavior: "allow" }, "saved")).toBe(true);
    target = "one";
    expect((await first.agent.run("ask again")).content).toBe("done");
    expect(approvals).toBe(3);
  } finally { first.close(); second.close(); await runtime.close(); }
}));

it("rejects a newly required approval or invalid hook decision at dispatch time", async () => isolated(async root => {
  const runtime = new RuntimeManager(root);
  let executions = 0;
  let checks = 0;
  let next: "ask" | "default" | "invalid" = "ask";
  runtime.events.onWaterfall("tool/permission", async (event, delegate) => {
    checks++;
    return delegate({ ...event, decision: checks % 2 ? "allow" : next as "ask" });
  });
  const managed = runtime.createAgent({ permission: "approval" }, { model: async () => ({ content: "", toolCalls: [] }) });
  managed.agent.register(defineTool({
    name: "fixture", description: "Fixture", inputSchema: { type: "object" },
    parseInput: () => ({}), assessRisk: () => ({ kind: "shell", reason: "Fixture" }),
    execute: () => { executions++; return "done"; },
  }));
  try {
    for (const decision of ["ask", "default", "invalid"] as const) {
      next = decision;
      await expect(managed.agent.tools.call("fixture", {}, undefined, "approval")).rejects.toThrow();
    }
    expect(executions).toBe(0);
  } finally { managed.close(); await runtime.close(); }
}));

it("lists copied rules and removes only the requested rule in its own scope", async () => isolated(async root => {
  const manager = new PermissionManager(root);
  const rule = { tool: "fixture", target: "one", behavior: "allow" as const };
  manager.add("first", rule, "session");
  manager.add("second", rule, "session");
  manager.add("first", rule, "saved");
  const displayed = manager.list("first", "saved");
  displayed[0]!.tool = "changed";
  expect(manager.list("first", "saved")).toEqual([rule]);
  expect(manager.remove("first", rule, "session")).toBe(true);
  expect(manager.list("first", "session")).toEqual([]);
  expect(manager.decide("second", "fixture", "one")).toBe("allow");
  expect(manager.remove("first", { ...rule, target: "other" }, "saved")).toBe(false);
  expect(new PermissionManager(root).list("other", "saved")).toEqual([rule]);
  expect(manager.remove("first", rule, "saved")).toBe(true);
  expect(manager.remove("first", rule, "saved")).toBe(false);
  expect(manager.decide("first", "fixture", "one")).toBe("default");
  expect(manager.decide("second", "fixture", "one")).toBe("allow");
  manager.clearSession("second");
  expect(manager.decide("second", "fixture", "one")).toBe("default");
}));

it("preserves saved rules when deletion encounters a lock or corrupt file", async () => isolated(async root => {
  const manager = new PermissionManager(root);
  const rule = { tool: "fixture", behavior: "deny" as const };
  manager.add("one", rule, "saved");
  writeFileSync(`${manager.path}.lock`, "busy");
  expect(() => manager.remove("one", rule, "saved")).toThrow("locked");
  rmSync(`${manager.path}.lock`);
  expect(manager.list("one", "saved")).toEqual([rule]);
  writeFileSync(manager.path, "invalid");
  expect(() => manager.remove("one", rule, "saved")).toThrow();
  expect(() => manager.list("one", "saved")).toThrow();
}));
