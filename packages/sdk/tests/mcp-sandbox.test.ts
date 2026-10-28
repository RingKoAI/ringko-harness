import { expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
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

const nativeAvailable = process.platform === "win32"
  || (process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec"))
  || (process.platform === "linux" && spawnSync("bwrap", ["--unshare-pid", "--ro-bind", "/", "/", "--", "true"], { stdio: "ignore" }).status === 0);

for (const mode of ["workspace-write", "read-only"] as const) it.skipIf(!nativeAvailable)(`confines local stdio MCP writes in ${mode}`, async () => {
  const root = mkdtempSync(join(tmpdir(), "ringko-mcp-sandbox-"));
  const outside = mkdtempSync(join(tmpdir(), "ringko-mcp-outside-"));
  const previousHome = process.env.RINGKO_HOME, previousAgents = process.env.AGENTS_HOME;
  process.env.RINGKO_HOME = join(root, "home");
  process.env.AGENTS_HOME = join(root, "agents");
  const server = join(root, "server.cjs");
  writeFileSync(server, SERVER);
  const node = Bun.which("node");
  if (!node) throw new Error("The native MCP test requires Node.js.");
  writeFileSync(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { local: { command: node, args: [server] } } }));
  const sandbox = new Sandbox({ workspace: root, mode });
  const manager = new McpManager(root);
  try {
    const started = await manager.start(sandbox);
    expect(started.errors).toEqual([]);
    const connection = started.connections.find(item => item.name === "local");
    expect(connection?.local).toBe(true);
    expect(connection?.sandboxMode).toBe(mode);
    expect(connection?.tools.map(tool => tool.name)).toEqual(["write_file"]);
    let insideDenied = false;
    try { await connection!.client.callTool("write_file", { path: "inside.txt", content: "ok" }); }
    catch { insideDenied = true; }
    expect(insideDenied).toBe(mode === "read-only");
    expect(existsSync(join(root, "inside.txt"))).toBe(mode === "workspace-write");
    let outsideDenied = false;
    try { await connection!.client.callTool("write_file", { path: join(outside, "outside.txt"), content: "bad" }); }
    catch { outsideDenied = true; }
    expect(outsideDenied).toBe(true);
    expect(existsSync(join(outside, "outside.txt"))).toBe(false);
  } finally {
    await manager.close();
    await Bun.sleep(300);
    if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
    if (previousAgents === undefined) delete process.env.AGENTS_HOME; else process.env.AGENTS_HOME = previousAgents;
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(outside, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}, 30_000);







