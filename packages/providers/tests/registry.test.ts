import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PROVIDER_PRESETS, setOAuthAccount } from "@ringko-ai/config";
import { createProviderClient } from "../src/index.ts";
import { canonicalProviderType, getProviderAdapter } from "../src/registry.ts";

it("provides a runtime adapter for every registered preset and retains transport aliases", () => {
  for (const preset of PROVIDER_PRESETS) expect(getProviderAdapter(preset.type)).toBeDefined();
  for (const [alias, type] of [["chatgpt", "openai-oauth"], ["oauth", "openai-oauth"], ["copilot", "github-copilot"], ["claude-oauth", "anthropic-oauth"], ["grok", "xai-oauth"], ["gemini", "google"], ["google-generative-ai", "google"], ["compatible", "openai-compatible"], ["opencodego", "opencode-go"]]) expect(canonicalProviderType(alias!)).toBe(type!);
  for (const value of ["__proto__", "constructor", "toString", "missing"]) {
    expect(getProviderAdapter(value)).toBeUndefined(); expect(() => createProviderClient({ provider: value, model: "fixture" })).toThrow("Unknown provider");
  }
});

it("still forces the Codex streaming transport through the independent OAuth adapter", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-oauth-registry-")), previous = process.env.RINGKO_HOME, originalFetch = globalThis.fetch;
  process.env.RINGKO_HOME = root;
  const captured: Array<{ url: string; body: Record<string, unknown> }> = [];
  try {
    setOAuthAccount("openai-oauth", { id: "fixture", authenticatedAt: Date.now(), credential: { type: "oauth", access: "fixture", refresh: "fixture", expires: Date.now() + 3_600_000, accountId: "fixture" } });
    globalThis.fetch = (async (input, init) => {
      captured.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return Response.json({ error: { message: "isolated-stream-probe" } }, { status: 400 });
    }) as typeof fetch;
    const client = createProviderClient({ provider: "openai-oauth", model: "gpt-fixture", stream: false });
    await expect(client({ messages: [{ role: "user", content: "probe" }], tools: [] })).rejects.toThrow("isolated-stream-probe");
    expect(captured).toHaveLength(1); expect(new URL(captured[0]!.url).pathname).toBe("/backend-api/codex/responses"); expect(captured[0]!.body.stream).toBe(true); expect(captured[0]!.body.store).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
