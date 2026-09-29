import { describe, expect, it } from "bun:test";
import { ApprovalHandlerUnavailableError, ToolApprovalRejectedError, ToolRegistry, executeTool } from "@ringko-ai/harness";
import { registerNetworkTools } from "../src/index.ts";
import { createWebSearchTool } from "../src/websearch.ts";

describe("websearch", () => {
  it("registers alongside webfetch and denies unapproved queries", async () => {
    const registry = new ToolRegistry();
    registerNetworkTools(registry);
    expect(registry.names()).toEqual(["webfetch", "websearch"]);
    await expect(registry.call("websearch", { query: "docs" })).rejects.toBeInstanceOf(ApprovalHandlerUnavailableError);
    await expect(registry.call("websearch", { query: "docs" }, async () => false)).rejects.toBeInstanceOf(ToolApprovalRejectedError);
  });

  it("sends a bounded approved query to the configured MCP search provider", async () => {
    let calls = 0;
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      calls++;
      const data = await request.json() as { method: string; params: { name: string; arguments: { query: string; numResults: number } } };
      expect(data.method).toBe("tools/call");
      expect(data.params.name).toBe("web_search_exa");
      expect(data.params.arguments.query).toBe("latest docs");
      expect(data.params.arguments.numResults).toBe(3);
      return new Response('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"Found docs"}]}}\n\n', { headers: { "content-type": "text/event-stream" } });
    } });
    try {
      const tool = createWebSearchTool({ endpoint: `http://127.0.0.1:${server.port}/mcp` });
      const result = await executeTool(tool, { query: "latest docs", numResults: 3 }, async request => {
        expect(request.target).toBe("latest docs");
        return true;
      });
      expect(result).toMatchObject({ query: "latest docs", provider: "exa", content: "Found docs" });
      expect(calls).toBe(1);
    } finally { server.stop(true); }
  });

  it("fails closed on missing provider credentials, malformed output and invalid arguments", async () => {
    const tool = createWebSearchTool({ provider: "parallel", endpoint: "http://127.0.0.1:1/mcp", apiKey: "" });
    await expect(executeTool(tool, { query: "docs" }, async () => true)).rejects.toThrow("PARALLEL_API_KEY");
    await expect(executeTool(tool, { query: "x".repeat(1001) }, async () => true)).rejects.toThrow("Invalid websearch");
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response('data: {not-json}\n\n') });
    try {
      await expect(executeTool(createWebSearchTool({ endpoint: `http://127.0.0.1:${server.port}/mcp` }), { query: "docs" }, async () => true)).rejects.toThrow("Invalid web search response");
    } finally { server.stop(true); }
  });
});
