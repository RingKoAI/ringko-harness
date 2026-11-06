import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolRegistry, defineTool, type ChatMessage, type ModelClient } from "@ringko-ai/harness";
import { SessionStore } from "@ringko-ai/session";
import { buildSubagentProviders } from "../src/subagents/config.ts";
import { SubagentManager } from "../src/subagents/manager.ts";
import { AcpProvider } from "../src/subagents/providers/acp.ts";
import { CommandProvider, claudeCodeProvider } from "../src/subagents/providers/command.ts";
import { InProcessProvider } from "../src/subagents/providers/in-process.ts";
import { OpenAiProvider } from "../src/subagents/providers/openai.ts";

function echoModel(seen: string[] = []): ModelClient {
  return async request => {
    const last = [...request.messages].reverse().find(message => message.role === "user" && !message.content.startsWith("Background job")) as ChatMessage | undefined;
    seen.push(last?.content ?? "");
    return { content: `echo:${last?.content ?? ""}`, toolCalls: [] };
  };
}

function toolsWithFixture(exposed: string[]): ToolRegistry {
  const tools = new ToolRegistry();
  for (const name of exposed) {
    const taskAccess = name === "write" || name === "edit" ? "write" : name === "read" ? "read" : undefined;
    tools.register(defineTool({ name, ...(taskAccess ? { taskAccess } : {}), description: name, inputSchema: { type: "object" }, parseInput: value => value, assessRisk: () => ({ kind: "safe", reason: name }), execute: () => "ok" }));
  }
  return tools;
}

function context(root: string, sessionStore: SessionStore, model: ModelClient, tools = new ToolRegistry(), parentSessionId?: string) {
  return {
    workspace: root,
    sessionStore,
    model,
    ...(parentSessionId ? { parentSessionId } : {}),
    tools,
    modelId: "test/child",
    models: ["test/child"],
    resolveModel: async () => model,
  };
}

it("reports every child disposal failure while closing the provider registry", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-child-disposal-"));
  const store = new SessionStore({ root: join(root, "sessions"), cwd: root });
  const provider = new InProcessProvider();
  const start = provider.start.bind(provider);
  let disposed = 0;
  provider.start = async (...args) => {
    const handle = await start(...args);
    const dispose = handle.dispose.bind(handle);
    handle.dispose = async () => { await dispose(); disposed++; throw new Error("fixture child cleanup"); };
    return handle;
  };
  const manager = new SubagentManager({ workspace: root, providers: [provider], context: context(root, store, echoModel()) });
  try {
    await (await manager.start({ description: "One", prompt: "one", mode: "read" })).result;
    await (await manager.start({ description: "Two", prompt: "two", mode: "read" })).result;
    await expect(manager.close()).rejects.toBeInstanceOf(AggregateError);
    expect(disposed).toBe(2);
    expect(manager.descriptors()).toEqual([]);
  } finally { await manager.close(); rmSync(root, { recursive: true, force: true }); }
});

it("keeps a durable in-process child across turns and manager instances", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-subagents-"));
  try {
    const store = new SessionStore({ cwd: root });
    const session = store.create();
    const seen: string[] = [];
    const model = echoModel(seen);
    const manager = new SubagentManager({
      workspace: root,
      providers: [new InProcessProvider()],
      session,
      context: context(root, store, model, new ToolRegistry(), session.id),
    });
    const started = await manager.start({ description: "Inspect", prompt: "one", mode: "read" });
    const first = await started.result;
    expect(first.status).toBe("completed");
    expect(first.content).toBe("echo:one");
    expect(started.entry.resumable).toBe(true);
    expect(started.entry.sessionId).toBeDefined();
    await started.send("two");
    expect(seen).toEqual(["one", "two"]);
    const catalog = manager.listChildren();
    expect(catalog[0]).toMatchObject({ provider: "in-process", resumable: true, content: "echo:two" });
    expect(session.all().filter(event => event.type === "task/message").length).toBeGreaterThanOrEqual(4);

    manager.resetRun();
    await new Promise(resolve => setTimeout(resolve, 20));
    const resumed = new SubagentManager({
      workspace: root,
      providers: [new InProcessProvider()],
      session,
      context: context(root, store, echoModel(), new ToolRegistry(), session.id),
    });
    const childId = catalog[0]!.childId;
    await resumed.send(childId, "three");
    expect(resumed.listChildren().find(entry => entry.childId === childId)?.content).toBe("echo:three");
    await resumed.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("exposes only the requested child capability mode", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-subagents-mode-"));
  try {
    const store = new SessionStore({ cwd: root });
    const session = store.create();
    let names: string[] = [];
    const model: ModelClient = async request => {
      names = request.tools.map(tool => tool.name).sort();
      return { content: "done", toolCalls: [] };
    };
    const manager = new SubagentManager({
      workspace: root,
      providers: [new InProcessProvider()],
      session,
      context: context(root, store, model, toolsWithFixture(["read", "write", "edit", "shell"]), session.id),
    });
    const started = await manager.start({ description: "Read", prompt: "inspect", mode: "read" });
    await started.result;
    expect(names).toEqual(["read"]);
    await manager.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("exposes the task and task_control tools over the shared catalog", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-subagents-tools-"));
  try {
    const store = new SessionStore({ cwd: root });
    const session = store.create();
    const model = echoModel();
    const manager = new SubagentManager({ workspace: root, providers: [new InProcessProvider()], session, context: context(root, store, model, new ToolRegistry(), session.id) });
    const tools = new ToolRegistry();
    tools.register(manager.taskTool());
    tools.register(manager.controlTool());
    const first = await tools.call("task", { description: "Inspect", prompt: "one", mode: "read" }, undefined, "full") as { taskId: string; content: string };
    expect(first.content).toBe("echo:one");
    const list = await tools.call("task_control", { action: "list" }, undefined, "full") as { children: Array<{ childId: string; resumable: boolean }> };
    expect(list.children).toHaveLength(1);
    expect(list.children[0]).toMatchObject({ childId: first.taskId, resumable: true });
    expect(await tools.call("task_control", { action: "status", taskId: first.taskId }, undefined, "full")).toMatchObject({ childId: first.taskId, status: "completed" });
    expect(await tools.call("task_control", { action: "send", taskId: first.taskId, prompt: "two" }, undefined, "full")).toEqual({ ok: true, taskId: first.taskId });
    expect((await tools.call("task_control", { action: "status", taskId: first.taskId }, undefined, "full") as { content?: string }).content).toBe("echo:two");
    await manager.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("validates configured providers and keeps the in-process default", () => {
  const defaults = buildSubagentProviders();
  expect(defaults.providers.map(provider => provider.name)).toEqual(["in-process"]);
  const built = buildSubagentProviders({ providers: [{ type: "in-process", name: "local" }, { type: "claude-code", name: "claude", command: "node" }, { type: "openai", name: "oa", model: "gpt-test", protocol: "chat" }] });
  expect(built.providers.map(provider => provider.name)).toEqual(["local", "claude", "oa"]);
  expect(() => buildSubagentProviders({ providers: [{ type: "command", name: "bad", command: "" }] })).toThrow("command");
  expect(() => buildSubagentProviders({ providers: [{ type: "command", name: "bad", command: "node", args: [1 as unknown as string] }] })).toThrow("string array");
  expect(() => buildSubagentProviders({ providers: [{ type: "openai", name: "bad", model: "gpt", auth: "oauth", protocol: "chat" }] })).toThrow("OAuth");
});

it("rejects unknown providers and unconfigured models before starting", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-subagents-validation-"));
  try {
    const store = new SessionStore({ cwd: root });
    const session = store.create();
    const manager = new SubagentManager({ workspace: root, providers: [new InProcessProvider()], session, context: context(root, store, echoModel(), new ToolRegistry(), session.id) });
    await expect(manager.start({ description: "Bad", prompt: "x", mode: "read", provider: "missing" })).rejects.toThrow("Unknown subagent provider");
    await expect(manager.start({ description: "Bad", prompt: "x", mode: "read", model: "unknown" })).rejects.toThrow("not configured");
    await manager.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("runs a Claude-style stream-json CLI and resumes its native session", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-subagent-cli-"));
  const script = join(root, "fake-claude.mjs");
  writeFileSync(script, `
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { input += chunk; });
process.stdin.on("end", () => {
  const resumed = process.argv.includes("--resume");
  process.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "native-1" }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "chunk:" + input.trim() }] } }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "answer:" + input.trim() + (resumed ? ":resumed" : ""), session_id: "native-1" }) + "\\n");
});
`);
  try {
    const provider = new CommandProvider({
      name: "fake-claude",
      command: process.execPath,
      args: [script],
      resumeArgs: [script, "--resume", "{sessionId}"],
      promptDelivery: "stdin",
      parser: "claude-stream-json",
      shell: false,
      capabilities: { continuable: true, resume: true, modelSelection: true, tools: false, approvals: false },
    });
    const store = new SessionStore({ cwd: root });
    const session = store.create();
    const manager = new SubagentManager({ workspace: root, providers: [provider], defaultProvider: "fake-claude", session, context: context(root, store, echoModel(), new ToolRegistry(), session.id) });
    const started = await manager.start({ description: "CLI", prompt: "one", mode: "read" });
    const first = await started.result;
    expect(first).toMatchObject({ status: "completed", content: "answer:one", metadata: { nativeSessionId: "native-1" } });
    await started.send!("two");
    expect(manager.listChildren()[0]).toMatchObject({ provider: "fake-claude", status: "completed", content: "answer:two:resumed" });
    const childId = started.entry.childId;
    await manager.release();
    const resumed = new SubagentManager({ workspace: root, providers: [provider], defaultProvider: "fake-claude", session, context: context(root, store, echoModel(), new ToolRegistry(), session.id) });
    await resumed.send(childId, "three");
    expect(resumed.listChildren()[0]).toMatchObject({ childId, status: "completed", content: "answer:three:resumed" });
    await resumed.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("interrupts a process provider and records cancellation", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-subagent-cancel-"));
  const script = join(root, "hang.mjs");
  writeFileSync(script, `process.stdin.resume(); setInterval(() => {}, 1000);\n`);
  try {
    const provider = new CommandProvider({ name: "hang", command: process.execPath, args: [script], parser: "text", shell: false });
    const store = new SessionStore({ cwd: root });
    const session = store.create();
    const manager = new SubagentManager({ workspace: root, providers: [provider], defaultProvider: "hang", session, context: context(root, store, echoModel(), new ToolRegistry(), session.id) });
    const started = await manager.start({ description: "Hang", prompt: "wait", mode: "read" });
    await new Promise(resolve => setTimeout(resolve, 50));
    manager.interrupt(started.entry.childId);
    expect(await started.result).toMatchObject({ status: "cancelled", stopReason: "aborted" });
    await manager.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("supports both OpenAI transports (Responses and Chat Completions)", async () => {
  const paths: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    paths.push(path);
    const body = await request.json() as { input?: unknown; messages?: unknown };
    void body;
    if (path.endsWith("/chat/completions")) {
      return Response.json({
        id: "chatcmpl-1", object: "chat.completion", created: 0, model: "gpt-test",
        choices: [{ index: 0, message: { role: "assistant", content: "chat answer" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }
    return Response.json({
      id: "resp-1", object: "response", created_at: 0, model: "gpt-test", status: "completed",
      output: [{ id: "msg-1", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "responses answer", annotations: [] }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
  } });
  const root = mkdtempSync(join(tmpdir(), "rkh-subagent-openai-"));
  try {
    const store = new SessionStore({ cwd: root });
    const session = store.create();
    for (const protocol of ["responses", "chat"] as const) {
      const provider = new OpenAiProvider({ name: `oa-${protocol}`, model: "gpt-test", protocol, baseURL: `http://127.0.0.1:${server.port}/v1`, apiKey: "test" });
      const manager = new SubagentManager({ workspace: root, providers: [provider], defaultProvider: provider.name, session, context: context(root, store, echoModel(), new ToolRegistry(), session.id) });
      const started = await manager.start({ description: "API", prompt: "hello", mode: "read" });
      const result = await started.result;
      expect(result).toMatchObject({ status: "completed", content: `${protocol} answer` });
      await manager.close();
    }
    expect(paths.some(path => path.endsWith("/responses"))).toBe(true);
    expect(paths.some(path => path.endsWith("/chat/completions"))).toBe(true);
  } finally {
    server.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
});

it("built-in Claude/Codex profiles build unattended argv", () => {
  expect(claudeCodeProvider().capabilities).toMatchObject({ continuable: true, resume: true });
  expect(claudeCodeProvider({ model: "opus" }).description).toContain("Claude Code");
});

it("drives an ACP agent over JSON lines with an unattended permission policy", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-subagent-acp-"));
  mkdirSync(root, { recursive: true });
  const script = join(root, "fake-acp.mjs");
  writeFileSync(script, `
import { createInterface } from "node:readline";
const rl = createInterface({ input: process.stdin });
const respond = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
rl.on("line", line => {
  const message = JSON.parse(line);
  if (message.method === "initialize") return respond(message.id, { protocolVersion: 1 });
  if (message.method === "session/new") return respond(message.id, { sessionId: "acp-1" });
  if (message.method === "session/prompt") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 99, method: "session/request_permission", params: { sessionId: "acp-1", options: [{ optionId: "no", kind: "reject_once" }, { optionId: "yes", kind: "allow_once" }] } }) + "\\n");
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "acp-1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "acp answer" } } } }) + "\\n");
    return respond(message.id, { stopReason: "end_turn" });
  }
});
`);
  try {
    const provider = new AcpProvider({ name: "acp-test", command: process.execPath, args: [script], permission: "reject", shell: false });
    const store = new SessionStore({ cwd: root });
    const session = store.create();
    const manager = new SubagentManager({ workspace: root, providers: [provider], defaultProvider: "acp-test", session, context: context(root, store, echoModel(), new ToolRegistry(), session.id) });
    const started = await manager.start({ description: "ACP", prompt: "do it", mode: "read" });
    const result = await started.result;
    expect(result).toMatchObject({ status: "completed", content: "acp answer" });
    await manager.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
