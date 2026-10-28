import { expect, it } from "bun:test";
import { McpClient, createHttpTransport, createSseTransport, createStdioTransport, openMcpServer } from "../src/index.ts";

it("never forwards MCP credentials through redirects or cross-origin SSE endpoints", async () => {
  let unauthorizedRequests = 0;
  const foreign = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => { unauthorizedRequests++; return Response.json({}); } });
  const target = `http://127.0.0.1:${foreign.port}/capture`;
  const authorized = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    if (new URL(request.url).pathname === "/sse") return new Response(`event: endpoint\ndata: ${target}\n\n`, { headers: { "content-type": "text/event-stream" } });
    return new Response(null, { status: 302, headers: { location: target } });
  } });
  const headers = { authorization: "Bearer isolated-fixture", "x-api-key": "isolated-fixture" };
  const http = createHttpTransport(`http://127.0.0.1:${authorized.port}/redirect`, headers);
  const sse = createSseTransport(`http://127.0.0.1:${authorized.port}/sse`, headers);
  try {
    await expect(http.send({ jsonrpc: "2.0", id: "1", method: "initialize" })).rejects.toThrow();
    await expect(sse.send({ jsonrpc: "2.0", id: "2", method: "initialize" })).rejects.toThrow("authorized origin");
    expect(unauthorizedRequests).toBe(0);
  } finally { await http.close(); await sse.close(); authorized.stop(true); foreign.stop(true); }
});

it("rejects pending MCP initialization promptly when its stdio server exits", async () => {
  await expect(openMcpServer("exiting", { command: process.execPath, args: ["-e", "process.exit(2)"] })).rejects.toThrow(/closed|exited/);
});

it("consumes a buffered final response before reporting stdio process exit", async () => {
  const transport = createStdioTransport({ command: process.execPath, args: ["-e", `require('node:readline').createInterface({input:process.stdin}).once('line', line => { const request=JSON.parse(line); process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result:'final-response'})+'\\n',()=>process.exit(0)); });`] });
  const client = new McpClient("final-response", transport);
  try { expect(await client.request("ping")).toBe("final-response"); }
  finally { await client.close(); }
});
