import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjects, saveConfig, saveProjects } from "@ringko-ai/config";
import { startServer } from "../src/server.ts";

it("reports the actual bound workspace instead of another backend's saved active project", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-project-bound-")), previous = process.env.RINGKO_HOME;
  process.env.RINGKO_HOME = join(root, "home");
  const left = join(root, "left"), right = join(root, "right"); mkdirSync(left); mkdirSync(right);
  saveConfig({ providers: [] }); saveProjects({ projects: [{ id: "left", name: "Left", path: left }, { id: "right", name: "Right", path: right }], current: "left" });
  const app = startServer({ workspace: right, port: 0, shared: true });
  try {
    const projects = await (await fetch(`${app.url}/api/projects`)).json();
    const info = await (await fetch(`${app.url}/api/info`)).json();
    expect(projects).toMatchObject({ current: "right", workspace: right, project: { id: "right" } });
    expect(info.project).toMatchObject({ id: "right" });
    expect((await fetch(`${app.url}/api/projects/right/current`, { method: "POST" })).status).toBe(200);
    expect((await fetch(`${app.url}/api/projects/left/current`, { method: "POST" })).status).toBe(409);
    // Another backend may update the shared preference; removing that entry
    // must not reset this backend's actual workspace.
    saveProjects({ projects: projects.projects, current: "left" });
    expect((await fetch(`${app.url}/api/projects/left`, { method: "DELETE" })).status).toBe(200);
    expect(await (await fetch(`${app.url}/api/projects`)).json()).toMatchObject({ current: "right", workspace: right });
    expect((await fetch(`${app.url}/api/projects/missing`, { method: "DELETE" })).status).toBe(404);
    saveProjects({ projects: projects.projects, current: "left" });
    expect((await fetch(`${app.url}/api/projects/right`, { method: "DELETE" })).status).toBe(200);
    expect(loadProjects().current).toBe("left");
    expect(await (await fetch(`${app.url}/api/projects`)).json()).toMatchObject({ current: null, workspace: right, project: null });
  } finally { await app.stop(); if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous; rmSync(root, { recursive: true, force: true }); }
});

it("reloads newly added workspace skills and MCP configuration after startup", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-project-reload-")), previous = process.env.RINGKO_HOME, previousAgents = process.env.AGENTS_HOME;
  process.env.RINGKO_HOME = join(root, "home"); process.env.AGENTS_HOME = join(root, "agents");
  const project = join(root, "workspace"); mkdirSync(join(project, ".agents"), { recursive: true });
  const mcp = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const message = await request.json() as { id?: string; method: string };
    if (!message.id) return new Response(null, { status: 202 });
    return Response.json({ jsonrpc: "2.0", id: message.id, result: message.method === "initialize" ? { serverInfo: { name: "workspace-fixture" } } : { tools: [{ name: "ping", inputSchema: { type: "object" } }] } });
  } });
  const endpoint = `http://127.0.0.1:${mcp.port}`;
  saveConfig({ providers: [], sandbox: { mcp: { workspace: { url: endpoint, readOnlyTools: ["ping"] } } } });
  saveProjects({ projects: [{ id: "workspace", name: "Workspace", path: project }], current: "workspace" });
  const app = startServer({ workspace: project, port: 0, shared: true });
  try {
    expect(await (await fetch(`${app.url}/api/skills`)).json()).toEqual([]);
    mkdirSync(join(project, ".agents/skills/added"), { recursive: true });
    writeFileSync(join(project, ".agents/skills/added/SKILL.md"), "---\nname: added\n---\nWorkspace skill");
    writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { workspace: { url: endpoint } } }));
    const response = await fetch(`${app.url}/api/reload`, { method: "POST" }); expect(response.status).toBe(200);
    const info = await response.json();
    expect((await (await fetch(`${app.url}/api/skills`)).json()).map((skill: { name: string }) => skill.name)).toContain("added");
    expect(info.tools).toContain("workspace__ping");
    rmSync(join(project, ".agents/skills/added"), { recursive: true });
    expect((await (await fetch(`${app.url}/api/skills`)).json()).map((skill: { name: string }) => skill.name)).toContain("added");
    expect(await (await fetch(`${app.url}/api/skills?refresh=1`)).json()).toEqual([]);
    writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { workspace: { url: `${endpoint}/unauthorized` } } }));
    const changedEndpoint = await fetch(`${app.url}/api/reload`, { method: "POST" });
    expect(changedEndpoint.status).toBe(200);
    expect((await changedEndpoint.json()).tools).not.toContain("workspace__ping");
    expect((await (await fetch(`${app.url}/api/mcp/connected`)).json()).errors).toContainEqual(expect.objectContaining({ name: "workspace", message: expect.stringContaining("authorization") }));
    writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: {} }));
    const removed = await fetch(`${app.url}/api/reload`, { method: "POST" });
    expect(removed.status).toBe(200);
    expect((await removed.json()).tools).not.toContain("workspace__ping");
  } finally { await app.stop(); mcp.stop(true); if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous; if (previousAgents === undefined) delete process.env.AGENTS_HOME; else process.env.AGENTS_HOME = previousAgents; rmSync(root, { recursive: true, force: true }); }
});

it("starts on the registered project and discovers that project's skills and MCP tools", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-project-scope-"));
  const project = join(root, "project");
  const previousHome = process.env.RINGKO_HOME;
  const previousAgents = process.env.AGENTS_HOME;
  process.env.RINGKO_HOME = join(root, "home");
  process.env.AGENTS_HOME = join(root, "agents");
  mkdirSync(join(project, ".agents", "skills", "alpha"), { recursive: true });
  writeFileSync(join(project, ".agents", "skills", "alpha", "SKILL.md"), "---\nname: alpha\ndescription: Project skill\n---\nAlpha instructions");
  const mcp = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const message = await request.json() as { id?: string; method: string };
    if (!message.id) return new Response(null, { status: 202 });
    if (message.method === "initialize") return Response.json({ jsonrpc: "2.0", id: message.id, result: { serverInfo: { name: "fixture" } } });
    if (message.method === "tools/list") return Response.json({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "echo", inputSchema: { type: "object" } }] } });
    return Response.json({ jsonrpc: "2.0", id: message.id, result: {} });
  } });
  writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { fixture: { url: `http://127.0.0.1:${mcp.port}` } } }));
  saveConfig({ sandbox: { mcp: { fixture: { url: `http://127.0.0.1:${mcp.port}`, readOnlyTools: ["echo"] } } } });
  saveProjects({ projects: [{ id: "project", name: "Project", path: project }], current: "project" }, process.env);
  const app = startServer({ port: 0, shared: true });
  try {
    const info = await (await fetch(`${app.url}/api/info`)).json();
    expect(info.workspace).toBe(project);
    expect(info.tools).toContain("skill");
    expect(info.tools).toContain("fixture__echo");
    const skills = await (await fetch(`${app.url}/api/skills`)).json();
    expect(skills.map((skill: { name: string }) => skill.name)).toContain("alpha");
    let connected: { servers?: Array<{ tools: Array<{ name: string }> }> } | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      connected = await (await fetch(`${app.url}/api/mcp/connected`)).json();
      if (connected?.servers?.[0]?.tools?.some(tool => tool.name === "echo")) break;
      await Bun.sleep(20);
    }
    expect(connected?.servers?.[0]?.tools).toEqual([expect.objectContaining({ name: "echo" })]);
  } finally {
    app.stop(); mcp.stop(true);
    if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
    if (previousAgents === undefined) delete process.env.AGENTS_HOME; else process.env.AGENTS_HOME = previousAgents;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

it("keeps frontend leases alive while a slow MCP reload blocks competing configuration changes", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-project-reload-lease-"));
  const previous = process.env.RINGKO_HOME, previousAgents = process.env.AGENTS_HOME;
  process.env.RINGKO_HOME = join(root, "home"); process.env.AGENTS_HOME = join(root, "agents");
  mkdirSync(join(root, ".agents"));
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const mcp = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const message = await request.json() as { id?: string; method: string };
    if (message.id === undefined) return new Response(null, { status: 202 });
    if (message.method === "tools/list") { entered.resolve(); await release.promise; }
    return Response.json({ jsonrpc: "2.0", id: message.id, result: message.method === "initialize" ? { serverInfo: { name: "slow-fixture" } } : { tools: [] } });
  } });
  const endpoint = `http://127.0.0.1:${mcp.port}`;
  saveConfig({ providers: [], sandbox: { mcp: { slow: { url: endpoint, readOnlyTools: [] } } } });
  const app = startServer({ workspace: root, port: 0, shared: true });
  let reload: Promise<Response> | undefined;
  try {
    const lease = await (await fetch(`${app.url}/api/backend/clients`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"kind":"cli"}' })).json();
    writeFileSync(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { slow: { url: endpoint } } }));
    reload = fetch(`${app.url}/api/reload`, { method: "POST" });
    await entered.promise;
    expect((await fetch(`${app.url}/api/skills?refresh=1`)).status).toBe(409);
    expect((await fetch(`${app.url}/api/reload`, { method: "POST" })).status).toBe(409);
    expect((await fetch(`${app.url}/api/backend/clients/${lease.id}`, { method: "PUT" })).status).toBe(200);
    expect((await fetch(`${app.url}/api/backend/clients/${lease.id}`, { method: "DELETE" })).status).toBe(200);
    release.resolve();
    expect((await reload).status).toBe(200);
  } finally {
    release.resolve(); await reload; await app.stop(); mcp.stop(true);
    if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous;
    if (previousAgents === undefined) delete process.env.AGENTS_HOME; else process.env.AGENTS_HOME = previousAgents;
    rmSync(root, { recursive: true, force: true });
  }
});
