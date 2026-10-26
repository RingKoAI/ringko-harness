import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveConfig } from "@ringko-ai/config";
import { BackendClient } from "@ringko-ai/client";
import { startServer } from "../src/server.ts";

const TOKEN = "tool-stage-token";

function completion(model: string, content: string, calls: Array<{ id: string; name: string; arguments: unknown }> = []): Response {
  const frame = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  return new Response(frame({ role: "assistant", content, ...(calls.length ? { tool_calls: calls.map((call, index) => ({ index, id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } : {}) }, null) + frame({}, calls.length ? "tool_calls" : "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
}

function headers(): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
}

function provider(respond: (turn: number, body: Record<string, unknown>) => Response) {
  let turns = 0;
  return Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json() as Record<string, unknown>;
    return respond(++turns, body);
  } });
}

it("registers, discovers and executes an MCP tool with recorded events", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-mcp-stages-"));
  const previousHome = process.env.RINGKO_HOME;
  process.env.RINGKO_HOME = join(root, "home");
  mkdirSync(process.env.RINGKO_HOME, { recursive: true });
  let mcpCalls = 0;
  const mcp = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const message = await request.json() as { id?: string; method: string; params?: { name?: string; arguments?: unknown } };
    if (!message.id) return new Response(null, { status: 202 });
    if (message.method === "initialize") return Response.json({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } } });
    if (message.method === "tools/list") return Response.json({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "echo", description: "Echo text.", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }] } });
    if (message.method === "tools/call") {
      mcpCalls += 1;
      return Response.json({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: JSON.stringify(message.params?.arguments ?? {}) }] } });
    }
    return Response.json({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "unknown" } });
  } });
  let requestTools: string[] = [];
  const chat = provider((turn, body) => {
    requestTools = Array.isArray(body.tools) ? (body.tools as Array<{ function?: { name?: string } }>).flatMap(tool => tool.function?.name ? [tool.function.name] : []) : [];
    return turn === 1
      ? completion("parent", "", [{ id: "mcp-call", name: "fixture__echo", arguments: { text: "mcp-ok" } }])
      : completion("parent", "mcp done");
  });
  let app: ReturnType<typeof startServer> | undefined;
  try {
    writeFileSync(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { fixture: { url: `http://127.0.0.1:${mcp.port}` } } }));
    saveConfig({ model: "Mock/parent", mode: "full", providers: [{ name: "Mock", type: "openai-compatible", baseURL: `http://127.0.0.1:${chat.port}/v1`, apiKey: "fixture", models: [{ id: "parent", name: "Parent" }] }] });
    app = startServer({ workspace: root, port: 0, authToken: TOKEN });

    // Registration: the saved server is listed.
    const configured = await (await fetch(`${app.url}/api/mcp`, { headers: headers() })).json();
    expect(configured.servers.map((server: { name: string }) => server.name)).toContain("fixture");

    // Discovery: startup connects, lists the tool, and the agent receives it.
    let connected: { servers?: Array<{ tools: Array<{ name: string }> }> } | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      connected = await (await fetch(`${app.url}/api/mcp/connected`, { headers: headers() })).json();
      if (connected?.servers?.[0]?.tools?.some(tool => tool.name === "echo")) break;
      await Bun.sleep(20);
    }
    expect(connected?.servers?.[0]?.tools).toEqual([expect.objectContaining({ name: "echo" })]);
    const info = await (await fetch(`${app.url}/api/info`, { headers: headers() })).json();
    expect(info.tools).toContain("fixture__echo");

    // Execution: the agent calls the tool, gets its result, and the session records it.
    const response = await fetch(`${app.url}/api/chat`, { method: "POST", headers: headers(), body: JSON.stringify({ prompt: "Use the MCP tool" }) });
    expect(response.status).toBe(200);
    await response.text();
    expect(mcpCalls).toBe(1);
    expect(requestTools).toContain("fixture__echo");
    const client = new BackendClient({ url: app.url, token: TOKEN, workspace: root });
    const session = await client.sessions();
    const snapshot = await client.snapshot(session[0]!.id);
    expect(snapshot.events.some(event => event.type === "tool/call" && event.data?.name === "fixture__echo")).toBe(true);
    expect(snapshot.events.some(event => event.type === "tool/result" && event.data?.name === "fixture__echo" && String(event.data?.content).includes("mcp-ok"))).toBe(true);
    expect(snapshot.messages.some(message => message.role === "assistant" && message.content === "mcp done")).toBe(true);
  } finally {
    app?.stop(); chat.stop(true); mcp.stop(true);
    if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

it("lists project/global skills with precedence and exposes them for execution", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-skill-stages-"));
  const home = join(root, "home");
  const previousHome = process.env.RINGKO_HOME;
  const previousAgents = process.env.AGENTS_HOME;
  process.env.RINGKO_HOME = home;
  process.env.AGENTS_HOME = join(root, "agents");
  const projectSkill = join(root, ".agents", "skills", "alpha");
  const globalAlpha = join(home, ".ringko", "skills", "alpha");
  const globalBeta = join(home, ".ringko", "skills", "beta");
  mkdirSync(projectSkill, { recursive: true });
  mkdirSync(globalAlpha, { recursive: true });
  mkdirSync(globalBeta, { recursive: true });
  writeFileSync(join(projectSkill, "SKILL.md"), "---\nname: alpha\ndescription: Project alpha\n---\nProject alpha instructions");
  writeFileSync(join(globalAlpha, "SKILL.md"), "---\nname: alpha\ndescription: Global alpha\n---\nGlobal alpha instructions");
  writeFileSync(join(globalBeta, "SKILL.md"), "---\nname: beta\ndescription: Global beta\n---\nGlobal beta instructions");
  mkdirSync(join(home, ".ringko", "skills", "broken"), { recursive: true });
  let requestTools: Array<{ function?: { name?: string; parameters?: { properties?: { name?: { enum?: string[] } } } } }> = [];
  const chat = provider((turn, body) => {
    requestTools = Array.isArray(body.tools) ? body.tools as typeof requestTools : [];
    return turn === 1
      ? completion("parent", "", [{ id: "skill-call", name: "skill", arguments: { name: "alpha" } }])
      : completion("parent", "skill done");
  });
  let app: ReturnType<typeof startServer> | undefined;
  try {
    saveConfig({ model: "Mock/parent", providers: [{ name: "Mock", type: "openai-compatible", baseURL: `http://127.0.0.1:${chat.port}/v1`, apiKey: "fixture", models: [{ id: "parent", name: "Parent" }] }] });
    app = startServer({ workspace: root, port: 0, authToken: TOKEN });

    // Listing: project alpha shadows global alpha; beta remains; broken is skipped.
    const skills = await (await fetch(`${app.url}/api/skills`, { headers: headers() })).json() as Array<{ name: string; description?: string; scope: string }>;
    expect(skills.filter(skill => skill.name === "alpha")).toEqual([expect.objectContaining({ description: "Project alpha", scope: "project" })]);
    expect(skills.some(skill => skill.name === "beta" && skill.scope === "global")).toBe(true);
    expect(skills.some(skill => skill.name === "broken")).toBe(false);
    expect((await (await fetch(`${app.url}/api/info`, { headers: headers() })).json()).tools).toContain("skill");

    // Execution: the skill tool is in the agent's schema and its result is recorded.
    const response = await fetch(`${app.url}/api/chat`, { method: "POST", headers: headers(), body: JSON.stringify({ prompt: "Use the project skill" }) });
    expect(response.status).toBe(200);
    await response.text();
    const skillTool = requestTools.find(tool => tool.function?.name === "skill");
    expect(skillTool?.function?.parameters?.properties?.name?.enum).toEqual(expect.arrayContaining(["alpha", "beta"]));
    expect(skillTool?.function?.parameters?.properties?.name?.enum).not.toContain("broken");
    const client = new BackendClient({ url: app.url, token: TOKEN, workspace: root });
    const snapshot = await client.snapshot((await client.sessions())[0]!.id);
    const result = snapshot.events.find(event => event.type === "tool/result" && event.data?.name === "skill");
    expect(result).toBeDefined();
    expect(String(result?.data?.content)).toContain("Project alpha instructions");
    expect(String(result?.data?.content)).not.toContain("Global alpha instructions");
  } finally {
    app?.stop(); chat.stop(true);
    if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
    if (previousAgents === undefined) delete process.env.AGENTS_HOME; else process.env.AGENTS_HOME = previousAgents;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
