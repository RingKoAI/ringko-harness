import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONTEXT_LIMITS, loadConfig, ModelCatalogCache, saveConfig } from "@ringko-ai/config";
import { BackendClient } from "@ringko-ai/client";
import { loadModel } from "../src/model.ts";
import { startServer } from "../src/server.ts";

it("uses loaded model limits for both backend context endpoints and refreshes after selection changes", async () => {
  const root = mkdtempSync(join(tmpdir(), "ringko-context-"));
  const previous = process.env.RINGKO_HOME;
  process.env.RINGKO_HOME = root;
  const providers = [{ name: "Fixture", type: "echo", models: [
    { id: "large", name: "Large", maxInputTokens: 262_144, maxOutputTokens: 8192 },
    { id: "unknown", name: "Unknown" },
    { id: "invalid", name: "Invalid", maxInputTokens: -1, maxOutputTokens: 0 },
  ] }];
  saveConfig({ model: "Fixture/large", providers, capabilities: { shell: false, network: false } });
  const app = startServer({ workspace: root, port: 0, shared: true });
  try {
    const client = new BackendClient({ url: app.url, workspace: root });
    const session = await client.createSession();
    for (const id of ["large", "unknown", "invalid"]) {
      const config = { model: `Fixture/${id}`, providers, capabilities: { shell: false, network: false } };
      saveConfig(config);
      const model = await loadModel(config);
      if (typeof model === "string") throw new Error(model);
      const expected = id === "large" ? { contextWindow: 262_144, reserveOutputTokens: 8192, maxInputTokens: 262_144 } : DEFAULT_CONTEXT_LIMITS;
      expect(model.limits).toEqual(expected);
      for (const path of ["/api/info", `/api/sessions/${session.id}/context`]) {
        const response = await fetch(`${app.url}${path}`);
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(path === "/api/info" ? body.context.limit : body.limit).toBe(model.limits.contextWindow);
      }
    }
  } finally {
    app.stop();
    if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

it("automatically refreshes backend context from Models.dev without changing user model settings", async () => {
  const root = mkdtempSync(join(tmpdir(), "ringko-context-catalog-"));
  const previousHome = process.env.RINGKO_HOME, previousUrl = process.env.RINGKO_MODELS_URL;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async () => {
    await gate;
    return Response.json({ fixture: { models: { capacity: { limit: { context: 262_144, input: 200_000, output: 128_000 } } } } });
  } });
  process.env.RINGKO_HOME = root;
  process.env.RINGKO_MODELS_URL = `http://127.0.0.1:${upstream.port}/api.json`;
  const providers = [{ name: "Fixture", type: "echo", models: [{ id: "wire-alias", name: "Alias", catalogId: "fixture/capacity" }] }];
  saveConfig({ model: "Fixture/wire-alias", providers, capabilities: { shell: false, network: false } });
  const app = startServer({ workspace: root, port: 0, shared: true });
  const cache = new ModelCatalogCache({ onError: () => {} });
  try {
    const info = async () => (await fetch(`${app.url}/api/info`)).json();
    expect((await info()).context.limit).toBe(DEFAULT_CONTEXT_LIMITS.contextWindow);
    release();
    const deadline = Date.now() + 5000;
    let result = await info();
    while (result.context.limit !== 262_144 && Date.now() < deadline) { await Bun.sleep(20); result = await info(); }
    expect(result.context.limit).toBe(262_144);
    const client = new BackendClient({ url: app.url, workspace: root });
    const session = await client.createSession();
    const context = await (await fetch(`${app.url}/api/sessions/${session.id}/context`)).json();
    expect(context.limit).toBe(262_144);
    const loaded = await loadModel(loadConfig(), cache);
    if (typeof loaded === "string") throw new Error(loaded);
    expect(loaded.limits).toEqual({ contextWindow: 262_144, maxInputTokens: 200_000, reserveOutputTokens: DEFAULT_CONTEXT_LIMITS.reserveOutputTokens });
    expect(loadConfig().providers?.[0].models?.[0]).toEqual(providers[0].models[0]);
    expect((await loaded.client({ messages: [{ role: "user", content: "wire model remains usable" }], tools: [] })).content).toBe("echo: wire model remains usable");
  } finally {
    release(); app.stop(); cache.dispose(); upstream.stop(true);
    if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
    if (previousUrl === undefined) delete process.env.RINGKO_MODELS_URL; else process.env.RINGKO_MODELS_URL = previousUrl;
    rmSync(root, { recursive: true, force: true });
  }
});
