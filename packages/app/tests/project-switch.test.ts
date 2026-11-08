import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveConfig } from "@ringko-ai/config";
import { startServer } from "../src/server.ts";

it("activates an added working directory and loads its skills and MCP tools", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-project-switch-"));
  const first = join(root, "first");
  const second = join(root, "second");
  const previousHome = process.env.RINGKO_HOME;
  const previousAgents = process.env.AGENTS_HOME;
  process.env.RINGKO_HOME = join(root, "home");
  process.env.AGENTS_HOME = join(root, "agents");
  for (const [base, name] of [[first, "alpha"], [second, "beta"]] as const) {
    mkdirSync(join(base, ".agents", "skills", name), { recursive: true });
    writeFileSync(join(base, ".agents", "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: Project skill\n---\n${name} instructions`);
  }
  const mcp = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const message = await request.json() as { id?: string; method: string };
    if (!message.id) return new Response(null, { status: 202 });
    if (message.method === "initialize") return Response.json({ jsonrpc: "2.0", id: message.id, result: { serverInfo: { name: "fixture" } } });
    if (message.method === "tools/list") return Response.json({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "echo", inputSchema: { type: "object" } }] } });
    return Response.json({ jsonrpc: "2.0", id: message.id, result: {} });
  } });
  const endpoint = `http://127.0.0.1:${mcp.port}`;
  writeFileSync(join(second, ".mcp.json"), JSON.stringify({ mcpServers: { fixture: { url: endpoint } } }));
  saveConfig({ sandbox: { mcp: { fixture: { url: endpoint, readOnlyTools: ["echo"] } } } });
  const app = startServer({ workspace: first, port: 0 });
  try {
    const response = await fetch(`${app.url}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: second }) });
    expect(response.status).toBe(200);
    const projects = await response.json();
    expect(projects.project?.name).toBe("second");
    expect(projects.workspace).toBe(second);

    const skills = await (await fetch(`${app.url}/api/skills`)).json();
    expect(skills.map((skill: { name: string }) => skill.name)).toEqual(["beta"]);

    let connected: { servers?: Array<{ name: string; tools: Array<{ name: string }> }> } | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      connected = await (await fetch(`${app.url}/api/mcp/connected`)).json();
      if (connected?.servers?.some(server => server.tools.some(tool => tool.name === "echo"))) break;
      await Bun.sleep(20);
    }
    expect(connected?.servers?.map(server => server.name)).toContain("fixture");

    let tools: string[] = [];
    for (let attempt = 0; attempt < 100; attempt++) {
      const info = await (await fetch(`${app.url}/api/info`)).json();
      tools = info.tools;
      if (tools.includes("fixture__echo")) break;
      await Bun.sleep(20);
    }
    expect(tools).toContain("fixture__echo");
  } finally {
    app.stop(); mcp.stop(true);
    if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
    if (previousAgents === undefined) delete process.env.AGENTS_HOME; else process.env.AGENTS_HOME = previousAgents;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
