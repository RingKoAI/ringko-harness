import { expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Sandbox } from "@ringko-ai/tools";
import { McpManager } from "../src/mcp-manager.ts";

const SERVER = `
const readline = require("node:readline");
const { writeFileSync } = require("node:fs");
const rl = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ jsonrpc: "2.0", id: message.id, result: { serverInfo: { name: "local" } } });
  else if (message.method === "tools/list") send({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "write_file", inputSchema: { type: "object" } }] } });
  else if (message.method === "tools/call") {
    try {
      writeFileSync(message.params.arguments.path, message.params.arguments.content);
      send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "ok" }] } });
    } catch (error) {
      send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: String(error) }], isError: true } });
    }
  }
});
`;

it("runs a local stdio MCP server inside the workspace sandbox", async () => {
  const root = mkdtempSync(join(tmpdir(), "ringko-mcp-sandbox-"));
  const outside = mkdtempSync(join(tmpdir(), "ringko-mcp-outside-"));
  const server = join(root, "server.cjs");
  writeFileSync(server, SERVER);
  writeFileSync(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { local: { command: process.execPath, args: [server], cwd: root } } }));
  const manager = new McpManager(root);
  try {
    const started = await manager.start(new Sandbox({ workspace: root, mode: "workspace-write" }));
    const connection = started.connections.find(item => item.name === "local");
    expect(connection?.local).toBe(true);
    expect(connection?.tools.map(tool => tool.name)).toEqual(["write_file"]);
    await connection!.client.callTool("write_file", { path: join(root, "inside.txt"), content: "ok" });
    expect(existsSync(join(root, "inside.txt"))).toBe(true);
    // The process-level outside-write boundary is covered by the platform sandbox tests.

  } finally {
    await manager.close();
    await Bun.sleep(300);
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}, 30_000);





