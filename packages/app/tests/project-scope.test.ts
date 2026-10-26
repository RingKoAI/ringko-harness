import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveProjects } from "@ringko-ai/config";
import { startServer } from "../src/server.ts";

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
