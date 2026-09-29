import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveWorkflowFile } from "@ringko-ai/workflow";
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
    return Response.json({ jsonrpc: "2.0", id: message.id, result: message.method === "initialize" ? { serverInfo: {} } : { tools: [{ name: "ping", inputSchema: { type: "object", properties: {} } }] } });
  } });
  writeFileSync(join(directory, ".mcp.json"), JSON.stringify({ mcpServers: { fixture: { url: `http://127.0.0.1:${server.port}` }, unavailable: {} } }));
  const runtime = new RuntimeManager(directory);
  const model = async (request: import("../src/index.ts").ModelRequest) => {
    expect(request.tools.some(tool => tool.name === "fixture__ping")).toBe(true);
    return { content: "done", toolCalls: [] };
  };
  const first = runtime.createAgent({}, { model });
  const reports: string[] = [];
  const second = runtime.createAgent({}, { model }, { report: message => reports.push(message) });
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
