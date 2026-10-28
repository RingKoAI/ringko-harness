import { expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpManager } from "../src/mcp-manager.ts";
import { Sandbox } from "@ringko-ai/tools";

it("reports discovery without starting or probing servers", async () => {
  const root = mkdtempSync(join(tmpdir(), "ringko-mcp-current-"));
  const old = process.env.RINGKO_HOME; process.env.RINGKO_HOME = join(root, "home");
  let attempts = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    attempts++;
    const message = await request.json() as { id?: string; method: string };
    if (message.method === "initialize") {
      return Response.json({ jsonrpc: "2.0", id: message.id, result: { serverInfo: { name: "fixture" } } });
    }
    return Response.json({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "ping", inputSchema: { type: "object" } }] } });
  } });
  writeFileSync(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { fixture: { url: `http://127.0.0.1:${server.port}` } } }));
  const manager = new McpManager(root);
  try {
    expect(manager.current()).toEqual({ connections: [], errors: [] });
    expect(attempts).toBe(0);
    await manager.start(undefined, { fixture: { url: `http://127.0.0.1:${server.port}` } });
    expect(manager.current().connections.map(connection => connection.name)).toEqual(["fixture"]);
    expect(manager.current().connections[0]?.tools.map(tool => tool.name)).toEqual(["ping"]);
    expect(attempts).toBeGreaterThan(0);
  } finally {
    await manager.close(); server.stop(true);
    if (old === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = old;
    rmSync(root, { recursive: true, force: true });
  }
});

it("prewarms configured MCP servers, stops after three failures and retries after reset", async () => {
  const root = mkdtempSync(join(tmpdir(), "ringko-mcp-retry-"));
  const old = process.env.RINGKO_HOME; process.env.RINGKO_HOME = join(root, "home");
  let attempts = 0;
  let available = false;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const message = await request.json() as { id?: string; method: string };
    if (message.method === "initialize") {
      attempts++;
      if (!available) return new Response("Unavailable", { status: 503 });
    }
    if (!message.id) return new Response(null, { status: 202 });
    return Response.json({ jsonrpc: "2.0", id: message.id, result: message.method === "initialize" ? { serverInfo: {} } : { tools: [{ name: "ping", inputSchema: { type: "object" } }] } });
  } });
  writeFileSync(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { flaky: { url: `http://127.0.0.1:${server.port}` } } }));
  const manager = new McpManager(root, 10);
  try {
    const [first, second] = await Promise.all([manager.start(undefined, { flaky: { url: `http://127.0.0.1:${server.port}` } }), manager.start()]);
    expect(attempts).toBe(1);
    expect(first.errors[0]?.message).toContain("attempt 1/3");
    expect(second.errors).toEqual(first.errors);
    await Bun.sleep(100);
    expect(attempts).toBe(3);
    expect((await manager.start()).errors[0]?.message).toContain("automatic retry stopped");
    available = true;
    await Bun.sleep(50);
    expect(attempts).toBe(3);
    await manager.reset();
    const fresh = await manager.start();
    expect(attempts).toBe(4);
    expect(fresh.errors).toEqual([]);
    expect(fresh.connections[0]?.name).toBe("flaky");
  } finally {
    await manager.close(); server.stop(true);
    if (old === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = old;
    rmSync(root, { recursive: true, force: true });
  }
});

it("rejects project-supplied remote grants and endpoint substitution before connecting", async () => {
  const root = mkdtempSync(join(tmpdir(), "ringko-mcp-authority-"));
  const previousHome = process.env.RINGKO_HOME, previousAgents = process.env.AGENTS_HOME;
  process.env.RINGKO_HOME = join(root, "home"); process.env.AGENTS_HOME = join(root, "agents");
  let attempts = 0;
  const remote = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => { attempts++; return Response.json({}); } });
  const endpoint = `http://127.0.0.1:${remote.port}/foreign`;
  writeFileSync(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { fixture: { command: "  ", url: endpoint, permissions: { url: endpoint, allowedTools: ["write"] } } } }));
  const manager = new McpManager(root);
  try {
    const result = await manager.start(undefined, { fixture: { url: `http://127.0.0.1:${remote.port}/authorized`, allowedTools: ["write"] } });
    expect(result.connections).toEqual([]);
    expect(result.errors[0]?.message).toContain("matching sandbox.mcp");
    expect(attempts).toBe(0);
  } finally {
    await manager.close(); remote.stop(true);
    if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
    if (previousAgents === undefined) delete process.env.AGENTS_HOME; else process.env.AGENTS_HOME = previousAgents;
    rmSync(root, { recursive: true, force: true });
  }
});

it("waits for async confinement readiness before launching a local MCP process", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-mcp-preparation-"));
  const previousHome = process.env.RINGKO_HOME, previousAgents = process.env.AGENTS_HOME;
  process.env.RINGKO_HOME = join(root, "home"); process.env.AGENTS_HOME = join(root, "agents");
  let release!: () => void;
  const prepared = new Promise<void>(resolve => { release = resolve; });
  class DeferredSandbox extends Sandbox { override async prepare() { await prepared; } }
  const marker = join(root, "started.txt");
  const script = `require('node:fs').writeFileSync(${JSON.stringify(marker)},'started');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:m.method==='initialize'?{serverInfo:{}}:{tools:[]}})+'\\n');});`;
  writeFileSync(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: ["-e", script] } } }));
  const manager = new McpManager(root);
  const opened = manager.start(new DeferredSandbox({ workspace: root, mode: "danger-full-access" }));
  try {
    await Bun.sleep(10);
    expect(existsSync(marker)).toBe(false);
    expect(manager.current().connections).toHaveLength(0);
    release();
    expect((await opened).connections).toHaveLength(1);
    expect(existsSync(marker)).toBe(true);
  } finally {
    release(); await opened; await manager.close();
    if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
    if (previousAgents === undefined) delete process.env.AGENTS_HOME; else process.env.AGENTS_HOME = previousAgents;
    rmSync(root, { recursive: true, force: true });
  }
});

it("fails closed without launching MCP after native preparation rejects", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-mcp-preparation-failure-"));
  const previousHome = process.env.RINGKO_HOME, previousAgents = process.env.AGENTS_HOME;
  process.env.RINGKO_HOME = join(root, "home"); process.env.AGENTS_HOME = join(root, "agents");
  class FailedSandbox extends Sandbox { override async prepare() { throw new Error("Preparation failed"); } }
  const marker = join(root, "must-not-start.txt");
  writeFileSync(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)},'unsafe')`] } } }));
  const manager = new McpManager(root);
  try {
    const result = await manager.start(new FailedSandbox({ workspace: root }));
    expect(result.connections).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(existsSync(marker)).toBe(false);
  } finally {
    await manager.close();
    if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
    if (previousAgents === undefined) delete process.env.AGENTS_HOME; else process.env.AGENTS_HOME = previousAgents;
    rmSync(root, { recursive: true, force: true });
  }
});
