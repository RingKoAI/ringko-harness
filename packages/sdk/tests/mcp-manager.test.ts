import { expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpManager } from "../src/mcp-manager.ts";

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
    const [first, second] = await Promise.all([manager.start(), manager.start()]);
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
