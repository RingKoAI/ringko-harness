import { describe, expect, it } from "bun:test";
import { ApprovalHandlerUnavailableError, ToolApprovalRejectedError, executeTool } from "@ringko-ai/harness";
import { createWebFetchTool } from "../src/webfetch.ts";
import { readBounded } from "../src/network.ts";

describe("webfetch", () => {
  it("rejects non-http(s) schemes", async () => {
    const tool = createWebFetchTool();
    await expect(executeTool(tool, { url: "file:///etc/passwd" }, async () => true)).rejects.toThrow(
      "Unsupported URL scheme",
    );
  });

  it("fails closed without an approval handler", async () => {
    const tool = createWebFetchTool();
    await expect(executeTool(tool, { url: "https://example.com" })).rejects.toBeInstanceOf(
      ApprovalHandlerUnavailableError,
    );
  });

  it("does not fetch when approval is denied", async () => {
    let calls = 0;
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => { calls++; return new Response("x"); } });
    try {
      await expect(executeTool(createWebFetchTool({ allowPrivateHosts: true }), { url: `http://127.0.0.1:${server.port}` }, async () => false)).rejects.toBeInstanceOf(ToolApprovalRejectedError);
      expect(calls).toBe(0);
    } finally { server.stop(true); }
  });

  it("fetches after approval and truncates the body", async () => {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("abcdefghij") });
    try {
      const output = await executeTool(createWebFetchTool({ maxBytes: 4, allowPrivateHosts: true }), { url: `http://127.0.0.1:${server.port}` }, async () => true);
      expect(output.status).toBe(200);
      expect(output.body).toBe("abcd");
      expect(output.truncated).toBe(true);
    } finally { server.stop(true); }
  });

  it("converts HTML after approval and rejects private destinations by default", async () => {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response('<h1>Heading</h1><script>secret()</script><p>Details &amp; more</p>', { headers: { "content-type": "text/html" } }) });
    try {
      const url = `http://127.0.0.1:${server.port}/page`;
      await expect(executeTool(createWebFetchTool(), { url }, async () => true)).rejects.toThrow("Private network");
      const tool = createWebFetchTool({ allowPrivateHosts: true });
      const markdown = await executeTool(tool, { url }, async () => true);
      expect(markdown.body).toContain("# Heading");
      expect(markdown.body).toContain("Details & more");
      expect(markdown.body).not.toContain("secret()");
      expect((await executeTool(tool, { url, format: "text" }, async () => true)).body).toBe("Heading\nDetails & more");
      expect((await executeTool(tool, { url, format: "html" }, async () => true)).body).toContain("<h1>Heading</h1>");
    } finally { server.stop(true); }
  });

  it("does not read an unbounded response or follow redirects", async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("more than allowed")); },
      cancel() { cancelled = true; },
    }));
    expect(await readBounded(response, 4)).toEqual({ text: "more", truncated: true });
    expect(cancelled).toBe(true);
    expect(await readBounded(new Response("exact"), 5)).toEqual({ text: "exact", truncated: false });
    let calls = 0;
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => { calls++; return new Response(null, { status: 302, headers: { location: "/private" } }); } });
    try {
      const result = await executeTool(createWebFetchTool({ allowPrivateHosts: true }), { url: `http://127.0.0.1:${server.port}/` }, async () => true);
      expect(calls).toBe(1);
      expect(result.redirect).toBe(`http://127.0.0.1:${server.port}/private`);
    } finally { server.stop(true); }
  });

  it("rejects invalid input before requesting approval", async () => {
    const tool = createWebFetchTool();
    for (const input of [
      { url: "https://user:secret@example.com" },
      { url: "http://2130706433/" },
      { url: "https://example.com", format: "binary" },
      { url: "https://example.com", timeout: 999 },
    ]) await expect(executeTool(tool, input, async () => true)).rejects.toThrow();
  });
});
