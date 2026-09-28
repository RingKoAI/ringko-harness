import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import { ToolRegistry } from "@ringko-ai/harness";
import { openMcpServer, registerMcpTools } from "../src/index.ts";

const fixture = fileURLToPath(new URL("./fixtures/echo-server.ts", import.meta.url));

describe("mcp stdio", () => {
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
