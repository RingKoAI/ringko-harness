import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diagnosticLogPath } from "@ringko-ai/config";
import { createStdioTransport } from "../src/transport.ts";
import { ToolRegistry } from "@ringko-ai/harness";
import { openMcpServer, registerMcpTools } from "../src/index.ts";

const fixture = fileURLToPath(new URL("./fixtures/echo-server.ts", import.meta.url));

describe("mcp stdio", () => {
  it("captures noisy child stderr without corrupting protocol output", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ringko-mcp-log-"));
    const previousHome = process.env.RINGKO_HOME;
    process.env.RINGKO_HOME = directory;
    const transport = createStdioTransport({
      command: process.execPath, diagnosticName: "noisy",
      args: ["-e", 'console.error("startup diagnostic"); setTimeout(() => { console.log(JSON.stringify({jsonrpc:"2.0",id:"1",result:"ok"})); }, 50);'],
    });
    try {
      const message = await new Promise<unknown>(resolve => transport.onMessage(resolve));
      expect(message).toEqual({ jsonrpc: "2.0", id: "1", result: "ok" });
      const log = readFileSync(diagnosticLogPath(), "utf8");
      expect(log).toContain("startup diagnostic");
      expect(log).toContain("mcp.noisy");
    } finally {
      await transport.close();
      if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("connects, lists tools, and calls one", async () => {
    const connection = await openMcpServer("echo", { command: "bun", args: [fixture] });
    try {
      expect(connection.tools.map((tool) => tool.name)).toEqual(["echo"]);
      const result = await connection.client.callTool("echo", { text: "hi" });
      expect(JSON.parse(result)).toEqual({ text: "hi" });
    } finally {
      await connection.client.close();
    }
  });

  it("registers MCP tools onto a harness registry", async () => {
    const connection = await openMcpServer("echo", { command: "bun", args: [fixture] });
    try {
      const registry = new ToolRegistry();
      const names = registerMcpTools(registry, [connection]);
      expect(names).toEqual(["echo__echo"]);
      expect(registry.get("echo__echo")?.concurrency).toBe("parallel");
      const output = await registry.call("echo__echo", { text: "yo" }, async () => true);
      expect(JSON.parse(output as string)).toEqual({ text: "yo" });
    } finally {
      await connection.client.close();
    }
  });

  it("fails a server without a command or url", async () => {
    await expect(openMcpServer("bad", {})).rejects.toThrow("command");
  });
});
