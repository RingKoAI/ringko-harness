import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server.ts";

it("discovers a provider's model list and rejects malformed requests", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-provider-models-"));
  const previousHome = process.env.RINGKO_HOME;
  process.env.RINGKO_HOME = root;
  const provider = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/v1/models") return Response.json({ data: [{ id: "alpha" }, { id: "beta", display_name: "Beta" }] });
      return new Response("missing", { status: 404 });
    },
  });
  const app = startServer({ port: 0, workspace: root, shared: true });
  const headers = { "content-type": "application/json" };
  try {
    const response = await fetch(`${app.url}/api/providers/models`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "fixture", type: "openai-compatible", baseURL: `http://127.0.0.1:${provider.port}/v1`, apiKey: "fixture" }),
    });
    expect(response.status).toBe(200);
    const result = await response.json() as { models: { id: string; name?: string }[]; truncated: boolean };
    expect(result.models).toEqual([{ id: "alpha" }, { id: "beta", name: "Beta" }]);
    expect(result.truncated).toBe(false);

    const invalidType = await fetch(`${app.url}/api/providers/models`, { method: "POST", headers, body: JSON.stringify({ type: "../escape" }) });
    expect(invalidType.status).toBe(400);
    const invalidUrl = await fetch(`${app.url}/api/providers/models`, { method: "POST", headers, body: JSON.stringify({ type: "openai-compatible", baseURL: "file:///etc/passwd" }) });
    expect(invalidUrl.status).toBe(400);
    const unreachable = await fetch(`${app.url}/api/providers/models`, {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "openai-compatible", baseURL: `http://127.0.0.1:${provider.port}/missing` }),
    });
    expect(unreachable.status).toBe(502);
  } finally {
    app.stop();
    provider.stop(true);
    if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
