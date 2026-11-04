import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineTool } from "@ringko-ai/harness";
import { saveWorkflowFile } from "@ringko-ai/workflow";
import { SessionStore, sessionTodos } from "@ringko-ai/session";
import { RuntimeManager } from "../src/runtime.ts";

async function isolated(test: (directory: string) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "ringko-runtime-"));
  const home = process.env.RINGKO_HOME;
  const agents = process.env.AGENTS_HOME;
  process.env.RINGKO_HOME = join(directory, "home");
  process.env.AGENTS_HOME = join(directory, "home");
  try { await test(directory); } finally {
    if (home === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = home;
    if (agents === undefined) delete process.env.AGENTS_HOME; else process.env.AGENTS_HOME = agents;
    rmSync(directory, { recursive: true, force: true });
  }
}

it("restores historical task snapshots through plan and persists update_plan changes", async () => isolated(async directory => {
  const store = new SessionStore({ root: join(directory, "sessions") });
  const session = store.create();
  session.appendEvent("session/todo", { todos: [{ content: "Historical step", status: "pending" }] });
  session.flush();
  const runtime = new RuntimeManager(directory);
  let turns = 0;
  const managed = runtime.createAgent({}, { session, model: async request => {
    expect(request.tools.some(tool => tool.name === "plan")).toBe(true);
    expect(request.tools.some(tool => tool.name === "update_plan")).toBe(true);
    expect(request.tools.some(tool => tool.name === "todoread" || tool.name === "todowrite")).toBe(false);
    if (++turns === 1) return { content: "", toolCalls: [{ id: "read-plan", name: "plan", arguments: {} }] };
    if (turns === 2) {
      expect(request.messages.at(-1)?.content).toContain("Historical step");
      return { content: "", toolCalls: [{ id: "write-plan", name: "update_plan", arguments: { todos: [{ content: "Historical step", status: "completed" }] } }] };
    }
    return { content: "done", toolCalls: [] };
  } });
  try {
    expect((await managed.agent.run("Complete the historical plan")).content).toBe("done");
    expect(sessionTodos(session.all())).toEqual([{ content: "Historical step", status: "completed" }]);
    runtime.permissions.add(session.id, { tool: "todowrite", behavior: "deny" }, "saved");
    await expect(managed.agent.tools.call("update_plan", { todos: [] })).rejects.toThrow();
    expect(sessionTodos(session.all())).toEqual([{ content: "Historical step", status: "completed" }]);
  } finally { managed.close(); await runtime.close(); session.close(); }
}));

it("applies ambient instructions, workflow policy, permission and ordered hooks", async () => isolated(async directory => {
  writeFileSync(join(directory, "AGENTS.md"), "Project guidance");
  saveWorkflowFile({ workflows: { restricted: { instructions: "Workflow guidance", tools: { deny: ["shell", "task"] } } } });
  const runtime = new RuntimeManager(directory);
  const order: string[] = [];
  runtime.events.on("run/before", async () => { order.push("before"); });
  runtime.events.on("run/after", () => { order.push("after"); });
  const managed = runtime.createAgent({ workflow: "restricted", permission: "assist", capabilities: { shell: true } }, {
    task: true,
    model: async request => {
      order.push("model");
      expect(request.messages.some(message => message.content.includes("Project guidance") && message.content.includes("Workflow guidance"))).toBe(true);
      expect(request.tools.some(tool => tool.name === "shell" || tool.name === "task")).toBe(false);
      return { content: "done", toolCalls: [] };
    },
  });
  try {
    expect(managed.agent.access.id).toBe("assist");
    await managed.agent.run("hello");
    expect(order).toEqual(["before", "model", "after"]);
  } finally { managed.close(); await runtime.close(); }
}));

it("shares pending MCP connections across agents and refreshes after reset", async () => isolated(async directory => {
  let initialized = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const message = await request.json() as { id?: string; method: string };
    if (!message.id) return new Response(null, { status: 202 });
    if (message.method === "initialize") { initialized++; await Bun.sleep(20); }
    return Response.json({ jsonrpc: "2.0", id: message.id, result: message.method === "initialize" ? { serverInfo: {} } : { tools: [{ name: "ping", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } }] } });
  } });
  writeFileSync(join(directory, ".mcp.json"), JSON.stringify({ mcpServers: { fixture: { url: `http://127.0.0.1:${server.port}` }, unavailable: {} } }));
  const policy = { sandbox: { mcp: { fixture: { url: `http://127.0.0.1:${server.port}`, readOnlyTools: ["ping"] } } } };
  const runtime = new RuntimeManager(directory);
  const model = async (request: import("../src/index.ts").ModelRequest) => {
    expect(request.tools.some(tool => tool.name === "fixture__ping")).toBe(true);
    return { content: "done", toolCalls: [] };
  };
  const first = runtime.createAgent(policy, { model });
  const reports: string[] = [];
  const second = runtime.createAgent(policy, { model }, { report: message => reports.push(message) });
  try {
    await Promise.all([first.agent.run("one"), second.agent.run("two")]);
    expect(initialized).toBe(1);
    expect(reports[0]).toContain("unavailable");
    first.close();
    await second.agent.run("three");
    expect(initialized).toBe(1);
    await runtime.resetMcp();
    await second.agent.run("four");
    expect(initialized).toBe(2);
  } finally { await runtime.close(); server.stop(true); }
}));

it("blocks execution on a rejected hook and closes agents and scheduled resources", async () => isolated(async directory => {
  const runtime = new RuntimeManager(directory);
  let calls = 0;
  runtime.events.on("run/before", async () => { throw new Error("blocked"); });
  const managed = runtime.createAgent({}, { model: async () => { calls++; return { content: "", toolCalls: [] }; } });
  await expect(managed.agent.run("hello")).rejects.toThrow("blocked");
  expect(calls).toBe(0);
  runtime.scheduler.create({ kind: "every", everyMs: 60_000 });
  runtime.permissions.add("conversation", { tool: "fixture", behavior: "allow" }, "session");
  await runtime.close();
  expect(runtime.scheduler.list()).toEqual([]);
  expect(runtime.permissions.list("conversation", "session")).toEqual([]);
  await expect(managed.agent.run("again")).rejects.toThrow();
  expect(() => runtime.createAgent({}, { model: async () => ({ content: "", toolCalls: [] }) })).toThrow("closed");
}));

it("routes a workflow model through the host resolver", async () => isolated(async directory => {
  saveWorkflowFile({ workflows: { routed: { model: "provider/model" } } });
  const runtime = new RuntimeManager(directory);
  const managed = runtime.createAgent({ workflow: "routed" }, {
    model: async () => { throw new Error("default model must not run"); },
    taskModels: ["provider/model"],
    resolveTaskModel: async id => { expect(id).toBe("provider/model"); return async () => ({ content: "routed", toolCalls: [] }); },
  });
  try { expect((await managed.agent.run("hello")).content).toBe("routed"); } finally { await runtime.close(); }
}));

it("reports invalid MCP configuration while keeping ordinary tools available", async () => isolated(async directory => {
  writeFileSync(join(directory, ".mcp.json"), "invalid JSON");
  const runtime = new RuntimeManager(directory);
  const reports: string[] = [];
  const managed = runtime.createAgent({}, { model: async request => {
    expect(request.tools.length).toBeGreaterThan(0);
    return { content: "done", toolCalls: [] };
  } }, { report: message => reports.push(message) });
  try {
    expect((await managed.agent.run("hello")).content).toBe("done");
    expect(reports[0]).toContain("configuration");
  } finally { await runtime.close(); }
}));

it("honors the configured agent turn budget", async () => isolated(async directory => {
  const runtime = new RuntimeManager(directory);
  const managed = runtime.createAgent({ maxTurns: 3 }, {
    model: async () => ({ content: "", toolCalls: [{ id: crypto.randomUUID(), name: "fixture", arguments: {} }] }),
  });
  managed.agent.register(defineTool({ name: "fixture", description: "Fixture", inputSchema: { type: "object" }, parseInput: () => ({}), assessRisk: () => ({ kind: "safe", reason: "Fixture" }), execute: () => "ok" }));
  try {
    await expect(managed.agent.run("loop")).rejects.toThrow("after 3 turns");
  } finally { managed.close(); await runtime.close(); }
}));

it("rejects a malformed configured turn budget", async () => isolated(async directory => {
  const runtime = new RuntimeManager(directory);
  try {
    expect(() => runtime.createAgent({ maxTurns: 0 }, { model: async () => ({ content: "", toolCalls: [] }) })).toThrow("maxTurns");
  } finally { await runtime.close(); }
}));

it("aborts before model execution and rejects concurrent agent runs", async () => isolated(async directory => {
  const runtime = new RuntimeManager(directory);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  runtime.events.on("run/before", () => pending);
  let calls = 0;
  const managed = runtime.createAgent({}, { model: async () => { calls++; return { content: "done", toolCalls: [] }; } });
  const run = managed.agent.run("one");
  await expect(managed.agent.run("two")).rejects.toThrow("already running");
  managed.close();
  await expect(run).rejects.toThrow();
  release();
  expect(calls).toBe(0);
  await runtime.close();
}));

it("loads discovered skills and rejects path input and oversized files", async () => isolated(async directory => {
  const skillDir = join(directory, "home", ".ringko", "skills", "example");
  mkdirSync(skillDir, { recursive: true });
  const skillPath = join(skillDir, "SKILL.md");
  writeFileSync(skillPath, "---\nname: example\ndescription: Example skill\n---\nSkill guidance");
  const runtime = new RuntimeManager(directory);
  const managed = runtime.createAgent({}, { model: async () => ({ content: "", toolCalls: [] }) });
  try {
    expect(await managed.agent.tools.call("skill", { name: "example" })).toContain("Skill guidance");
    await expect(managed.agent.tools.call("skill", { name: "../example" })).rejects.toThrow("Unknown skill");
    writeFileSync(skillPath, "x".repeat(65 * 1024));
    await expect(managed.agent.tools.call("skill", { name: "example" })).rejects.toThrow("64 KiB");
  } finally { await runtime.close(); }
}));

it("fails closed when an explicit permission or workflow tool policy is malformed", async () => isolated(async directory => {
  const runtime = new RuntimeManager(directory);
  const options = { model: async () => ({ content: "", toolCalls: [] }) };
  try {
    expect(() => runtime.createAgent({ permission: "invalid", mode: "full" }, options)).toThrow("permission");
    saveWorkflowFile({ workflows: { malformed: { tools: { deny: "shell" as unknown as string[] } } } });
    expect(() => runtime.createAgent({ workflow: "malformed" }, options)).toThrow("policy");
  } finally { await runtime.close(); }
}));

it("registers both network tools and enforces saved denial before provider access", async () => isolated(async directory => {
  const runtime = new RuntimeManager(directory);
  runtime.permissions.add("", { tool: "websearch", behavior: "deny" }, "saved");
  const managed = runtime.createAgent({ capabilities: { network: true }, permission: "full" }, { model: async () => ({ content: "", toolCalls: [] }) });
  try {
    expect(managed.agent.tools.names()).toContain("webfetch");
    expect(managed.agent.tools.names()).toContain("websearch");
    await expect(managed.agent.tools.call("websearch", { query: "test" }, undefined, "full")).rejects.toThrow("Approval was not granted");
  } finally { managed.close(); await runtime.close(); }
}));

it("gives the model a native tree tool and executes it with shell capability disabled", async () => isolated(async directory => {
  mkdirSync(join(directory, "structure"));
  writeFileSync(join(directory, "structure", "index.ts"), "file contents must not be returned");
  const runtime = new RuntimeManager(directory);
  let calls = 0;
  const managed = runtime.createAgent({ capabilities: { shell: false } }, {
    model: async request => {
      expect(request.tools.some(tool => tool.name === "tree")).toBe(true);
      expect(request.tools.some(tool => tool.name === "shell")).toBe(false);
      if (calls++ === 0) return { content: "", toolCalls: [{ id: "structure", name: "tree", arguments: { path: "structure", max_depth: 2 } }] };
      const result = request.messages.at(-1);
      expect(result?.role).toBe("tool");
      const output = JSON.parse(result!.content);
      expect(output.tree).toContain("index.ts");
      expect(output.tree).not.toContain("file contents must not be returned");
      expect(output.files).toBe(1);
      return { content: "tree verified", toolCalls: [] };
    },
  });
  try { expect((await managed.agent.run("Show directory structure using tree")).content).toBe("tree verified"); }
  finally { managed.close(); await runtime.close(); }
}));


it("registers runtime contributions and releases agent-scoped handlers", async () => isolated(async directory => {
  const runtime = new RuntimeManager(directory);
  const order: string[] = [];
  const dispose = await runtime.use({
    name: "fixture-contribution",
    setup(context) {
      expect(context.workspace).toBe(directory);
      context.onAgent((agent) => {
        agent.tools.register(defineTool({
          name: "fixture_tool",
          description: "Fixture tool",
          inputSchema: { type: "object", properties: {} },
          parseInput: () => ({}),
          assessRisk: () => ({ kind: "safe", reason: "Fixture" }),
          execute: () => "ok",
        }));
        order.push("agent");
        return () => { order.push("agent-dispose"); };
      });
      return () => { order.push("contribution-dispose"); };
    },
  });
  const managed = runtime.createAgent({}, { model: async () => ({ content: "done", toolCalls: [] }) });
  try {
    expect(managed.agent.tools.names()).toContain("fixture_tool");
    await expect(runtime.use({ name: "fixture-contribution", setup() {} })).rejects.toThrow("already registered");
    await expect(runtime.use({ name: "broken", setup() { throw new Error("setup failed"); } })).rejects.toThrow("setup failed");
  } finally {
    managed.close();
    await dispose();
    await runtime.close();
  }
  expect(order).toEqual(["agent", "agent-dispose", "contribution-dispose"]);
}));

it("disposes runtime contributions in reverse registration order", async () => isolated(async directory => {
  const runtime = new RuntimeManager(directory);
  const order: string[] = [];
  await runtime.use({ name: "first", setup: () => () => { order.push("first"); } });
  await runtime.use({ name: "second", setup: () => () => { order.push("second"); } });
  await runtime.close();
  expect(order).toEqual(["second", "first"]);
}));

it("includes contribution tools in runtime previews", async () => isolated(async directory => {
  const runtime = new RuntimeManager(directory);
  await runtime.use({
    name: "preview-tool",
    setup(context) {
      context.onAgent(agent => {
        agent.tools.register(defineTool({
          name: "preview_only",
          description: "Preview-only tool",
          inputSchema: { type: "object", properties: {} },
          parseInput: () => ({}),
          assessRisk: () => ({ kind: "safe", reason: "Fixture" }),
          execute: () => "ok",
        }));
      });
    },
  });
  try {
    expect(runtime.previewTools({}).agent.tools.names()).toContain("preview_only");
  } finally {
    await runtime.close();
  }
}));

it("runs model hooks with primary usage kinds and records failures", async () => isolated(async directory => {
  const runtime = new RuntimeManager(directory);
  const events: string[] = [];
  runtime.events.on("model/before-request", event => {
    events.push(`before:${event.kind}`);
    expect(event.toolCount).toBeGreaterThan(0);
  });
  runtime.events.on("model/after-response", event => {
    events.push(`after:${event.kind}:${event.failed}:${event.usage?.outputTokens ?? 0}`);
  });
  const managed = runtime.createAgent({}, {
    model: async () => ({ content: "done", toolCalls: [], usage: { inputTokens: 5, outputTokens: 2 } }),
  });
  try {
    expect((await managed.agent.run("hello")).content).toBe("done");
    expect(events).toEqual(["before:primary", "after:primary:false:2"]);
  } finally { managed.close(); await runtime.close(); }
}));

it("blocks model requests when a before hook fails and reports failing turns", async () => isolated(async directory => {
  const runtime = new RuntimeManager(directory);
  const events: string[] = [];
  let calls = 0;
  runtime.events.on("model/after-response", event => {
    events.push(`after:${event.failed}:${event.error ?? ""}`);
  });
  const managed = runtime.createAgent({}, {
    model: async () => {
      calls += 1;
      throw new Error("provider failed");
    },
  });
  try {
    await expect(managed.agent.run("failed")).rejects.toThrow("provider failed");
    expect(calls).toBe(1);
    expect(events).toEqual(["after:true:provider failed"]);
  } finally { managed.close(); await runtime.close(); }
  const blocker = new RuntimeManager(directory);
  blocker.events.on("model/before-request", () => { throw new Error("model blocked"); });
  const blocked = blocker.createAgent({}, { model: async () => { calls += 1; return { content: "unexpected", toolCalls: [] }; } });
  try {
    await expect(blocked.agent.run("blocked")).rejects.toThrow("model blocked");
    expect(calls).toBe(1);
  } finally { blocked.close(); await blocker.close(); }
}));

it("runs tool hooks and blocks execution when a pre-execute hook fails", async () => isolated(async directory => {
  const runtime = new RuntimeManager(directory);
  const events: string[] = [];
  let executions = 0;
  runtime.events.on("tool/pre-execute", event => {
    events.push(`pre:${event.toolName}`);
    throw new Error("blocked by policy");
  });
  runtime.events.on("tool/post-execute", event => {
    events.push(`post:${event.toolName}:${event.failed}`);
  });
  const managed = runtime.createAgent({}, {
    model: async request => request.messages.some(message => message.role === "tool")
      ? { content: "done", toolCalls: [] }
      : { content: "", toolCalls: [{ id: "call-hook", name: "hook_fixture", arguments: {} }] },
  });
  managed.agent.register(defineTool({
    name: "hook_fixture",
    description: "Hook fixture",
    inputSchema: { type: "object", properties: {} },
    parseInput: () => ({}),
    assessRisk: () => ({ kind: "safe", reason: "Fixture" }),
    execute: () => { executions += 1; return "ok"; },
  }));
  try {
    expect((await managed.agent.run("use the hook")).content).toBe("done");
    expect(executions).toBe(0);
    expect(events).toEqual(["pre:hook_fixture", "post:hook_fixture:true"]);
  } finally { managed.close(); await runtime.close(); }
}));
