import { afterEach, describe, expect, it } from "bun:test";
import { ApprovalHandlerUnavailableError, ToolApprovalRejectedError, executeTool } from "@ringko-ai/harness";
import { createWebFetchTool } from "../src/webfetch.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

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
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("x");
    }) as unknown as typeof fetch;
    await expect(executeTool(createWebFetchTool(), { url: "https://example.com" }, async () => false)).rejects.toBeInstanceOf(
      ToolApprovalRejectedError,
    );
    expect(called).toBe(false);
  });

  it("fetches after approval and truncates the body", async () => {
    globalThis.fetch = (async () => new Response("abcdefghij")) as unknown as typeof fetch;
    const output = await executeTool(createWebFetchTool({ maxBytes: 4 }), { url: "https://example.com" }, async () => true);
    expect(output.status).toBe(200);
    expect(output.body).toBe("abcd");
  });
});
