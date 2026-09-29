import { afterAll, describe, expect, it } from "bun:test";
import { authorizeMcpServer, openMcpServer } from "../src/index.ts";

/** Fake remote MCP server + OAuth authorization server on one origin. */
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
      return Response.json({ authorization_servers: [url.origin] });
    }
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return Response.json({
        authorization_endpoint: `${url.origin}/authorize`,
        token_endpoint: `${url.origin}/token`,
        registration_endpoint: `${url.origin}/register`,
        scopes_supported: ["mcp.read", "mcp.write"],
      });
    }
    if (url.pathname === "/register") return Response.json({ client_id: "client-1" });
    if (url.pathname === "/authorize") {
      const redirect = url.searchParams.get("redirect_uri") ?? "";
      const state = url.searchParams.get("state") ?? "";
      return Response.redirect(`${redirect}?code=code-1&state=${encodeURIComponent(state)}`, 302);
    }
    if (url.pathname === "/token") {
      return Response.json({ access_token: "access-123", refresh_token: "refresh-1", expires_in: 3600 });
    }
    if (url.pathname === "/mcp") {
      const message = (await request.json()) as { id?: string; method?: string };
      const result =
        message.method === "initialize"
          ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "http-echo" } }
          : message.method === "tools/list"
            ? { tools: [{ name: "ping", description: "Ping", inputSchema: { type: "object", properties: {} } }] }
            : message.method === "tools/call"
              ? { content: [{ type: "text", text: "pong" }] }
              : undefined;
      if (result === undefined) {
        return Response.json({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "not found" } });
      }
      return Response.json({ jsonrpc: "2.0", id: message.id, result });
    }
    return new Response("not found", { status: 404 });
  },
});

const base = `http://127.0.0.1:${server.port}`;

afterAll(() => {
  server.stop(true);
});

describe("mcp streamable http", () => {
  it("rejects oversized responses and repeated tool listing cursors", async () => {
    const fixture = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const message = await request.json() as { id?: string; method: string };
      if (!message.id) return new Response(null, { status: 202 });
      if (new URL(request.url).pathname === "/large") return new Response("x".repeat(1024 * 1024 + 1));
      return Response.json({ jsonrpc: "2.0", id: message.id, result: message.method === "initialize" ? { serverInfo: {} } : { tools: [], nextCursor: "same" } });
    } });
    try {
      await expect(openMcpServer("large", { url: `http://127.0.0.1:${fixture.port}/large` })).rejects.toThrow("1 MiB");
      await expect(openMcpServer("loop", { url: `http://127.0.0.1:${fixture.port}/mcp` })).rejects.toThrow("repeats its cursor");
    } finally { fixture.stop(true); }
  });

  it("connects over HTTP and lists tools", async () => {
    const connection = await openMcpServer("http-echo", { type: "http", url: `${base}/mcp` });
    try {
      expect(connection.tools.map((tool) => tool.name)).toEqual(["ping"]);
      expect(await connection.client.callTool("ping", {})).toBe("pong");
    } finally {
      await connection.client.close();
    }
  });

  it("runs discovery, dynamic registration, and the PKCE loopback flow", async () => {
    let authUrl = "";
    const pending = authorizeMcpServer(`${base}/mcp`, (value) => {
      authUrl = value;
    });
    while (authUrl.length === 0) await Bun.sleep(10);
    expect(authUrl).toContain("/authorize");
    expect(authUrl).toContain("code_challenge_method=S256");
    expect(authUrl).toContain("client_id=client-1");

    await fetch(authUrl, { redirect: "follow" });
    const credential = await pending;
    expect(credential.access).toBe("access-123");
    expect(credential.refresh).toBe("refresh-1");
    expect(credential.tokenEndpoint).toBe(`${base}/token`);
    expect(credential.clientId).toBe("client-1");
  });
});
