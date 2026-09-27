import { afterEach, describe, expect, it } from "bun:test";
import {
  ApprovalHandlerUnavailableError,
  ToolApprovalRejectedError,
  executeTool,
} from "@ringko-ai/harness";
import { createFetchUrlTool } from "./network.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetch_url tool", () => {
  it("rejects non-http(s) schemes during parsing", async () => {
    const tool = createFetchUrlTool();

    await expect(executeTool(tool, { url: "file:///etc/passwd" }, async () => true)).rejects.toThrow(
      "Unsupported URL scheme",
    );
    await expect(executeTool(tool, { url: "ftp://example.com" }, async () => true)).rejects.toThrow(
      "Unsupported URL scheme",
    );
  });

  it("fails closed without an approval handler", async () => {
    const tool = createFetchUrlTool();

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
    const tool = createFetchUrlTool();

    await expect(
      executeTool(tool, { url: "https://example.com" }, async () => false),
    ).rejects.toBeInstanceOf(ToolApprovalRejectedError);
    expect(called).toBe(false);
  });

  it("fetches after approval and truncates the body", async () => {
    globalThis.fetch = (async () => new Response("abcdefghij")) as unknown as typeof fetch;
    const tool = createFetchUrlTool({ maxBytes: 4 });

    const output = await executeTool(tool, { url: "https://example.com" }, async () => true);

    expect(output.status).toBe(200);
    expect(output.body).toBe("abcd");
  });
});
