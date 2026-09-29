import { expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server.ts";

it("starts configured MCP servers on Web startup before any model run", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "rkh-mcp-start-"));
  const previous = process.env.RINGKO_HOME; process.env.RINGKO_HOME = join(workspace, "home");
  let initialized = 0;
  const mcp = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const message = await request.json() as { id?: string; method: string };
    if (message.method === "initialize") initialized++;
    if (!message.id) return new Response(null, { status: 202 });
    return Response.json({ jsonrpc: "2.0", id: message.id, result: message.method === "initialize" ? { serverInfo: {} } : { tools: [] } });
  } });
  writeFileSync(join(workspace, ".mcp.json"), JSON.stringify({ mcpServers: { fixture: { url: `http://127.0.0.1:${mcp.port}` } } }));
  const app = startServer({ workspace, port: 0 });
  try {
    for (let index = 0; index < 40 && initialized === 0; index++) await Bun.sleep(10);
    expect(initialized).toBe(1);
    const response = await fetch(`${app.url}/api/mcp/connected`);
    expect(response.status).toBe(200);
  } finally {
    app.stop(); mcp.stop(true);
    if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous;
    rmSync(workspace, { recursive: true, force: true });
  }
});
