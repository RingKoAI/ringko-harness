import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, loadProviders, saveConfig, saveConfigFile } from "@ringko-ai/config";
import { startServer, type RingkoServer } from "../src/server.ts";

let root: string, path: string, app: RingkoServer, upstream: ReturnType<typeof Bun.serve>, providerRequests: number;
let previous: { home?: string; agents?: string; catalog?: string };
const token = "model-settings-fixture-token";
const model = { id: "alias", name: "Alias", catalogId: "fixture/capacity", vision: false, toolCalling: true };
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rkh-model-settings-")); path = join(root, "explicit.json"); providerRequests = 0;
  previous = { home: process.env.RINGKO_HOME, agents: process.env.AGENTS_HOME, catalog: process.env.RINGKO_MODELS_URL };
  process.env.RINGKO_HOME = join(root, "home"); process.env.AGENTS_HOME = join(root, "agents");
  upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    if (new URL(request.url).pathname !== "/catalog") { providerRequests++; return new Response("must not probe a provider", { status: 500 }); }
    return Response.json({ fixture: { models: { capacity: { id: "capacity", name: "Capacity", limit: { context: 262144, input: 200000, output: 128000 } } } } });
  } });
  process.env.RINGKO_MODELS_URL = `http://127.0.0.1:${upstream.port}/catalog`;
  saveConfig({ thinking: "off", model: "Global/original", providers: [{ name: "Global", type: "echo", models: [{ id: "original", name: "Original" }] }] });
  saveConfigFile({ thinking: "low", model: "Fixture/alias", providers: [{ name: "Fixture", type: "echo", models: [model] }] }, path);
  app = startServer({ workspace: root, port: 0, shared: true, configPath: path, authToken: token });
});
afterEach(async () => {
  await app.stop(); upstream.stop(true);
  for (const [key, value] of [["RINGKO_HOME", previous.home], ["AGENTS_HOME", previous.agents], ["RINGKO_MODELS_URL", previous.catalog]] as const) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  rmSync(root, { recursive: true, force: true });
});
const request = (route: string, body?: unknown, method = body ? "POST" : "GET") => fetch(`${app.url}${route}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });

it("edits capacity in the active explicit file and preserves flags and global configuration", async () => {
  const loaded = await (await request("/api/providers")).json();
  expect(loaded.model).toBe("Fixture/alias");
  loaded.providers[0].models[0] = { ...model, contextWindow: 524288, maxInputTokens: 400000, maxOutputTokens: 8192 };
  const saved = await request("/api/providers", loaded, "PUT"); expect(saved.status).toBe(200);
  expect((await saved.json()).context.limit).toBe(524288);
  expect(loadConfig({ path })).toMatchObject({ thinking: "low", providers: [{ models: [{ ...model, contextWindow: 524288, maxInputTokens: 400000, maxOutputTokens: 8192 }] }] });
  expect(loadProviders().model).toBe("Global/original"); expect(loadConfig().thinking).toBe("off");
});

it("rejects invalid token limits before writing either configuration file", async () => {
  const before = readFileSync(path, "utf8"), global = JSON.stringify(loadProviders());
  for (const field of ["contextWindow", "maxInputTokens", "maxOutputTokens"]) for (const value of [0, -1, 1.5, "128000", null, Number.MAX_SAFE_INTEGER + 1]) {
    const response = await request("/api/providers", { providers: [{ name: "Fixture", type: "echo", models: [{ ...model, [field]: value }] }] }, "PUT");
    expect(response.status).toBe(400); expect(readFileSync(path, "utf8")).toBe(before);
  }
  expect((await request("/api/providers", { providers: [{ name: "Fixture", models: [{ ...model, contextWindow: 100, maxOutputTokens: 101 }] }] }, "PUT")).status).toBe(400);
  expect(JSON.stringify(loadProviders())).toBe(global);
});

it("previews automatic metadata without probing a provider or persisting manual limits", async () => {
  const before = readFileSync(path, "utf8");
  const input = { provider: { name: "Fixture", type: "echo", baseURL: `http://127.0.0.1:${upstream.port}/provider`, apiKey: "must-not-forward" }, model: { ...model, contextWindow: 524288, maxOutputTokens: 8192 } };
  let preview;
  const deadline = Date.now() + 5000;
  do { const response = await request("/api/providers/context", input); expect(response.status).toBe(200); preview = await response.json(); if (!preview.metadata) await Bun.sleep(20); } while (!preview.metadata && Date.now() < deadline);
  expect(preview.metadata.limit).toEqual({ context: 262144, input: 200000, output: 128000 });
  expect(preview.automatic).toEqual({ contextWindow: 262144, maxInputTokens: 200000, reserveOutputTokens: 4096 });
  expect(providerRequests).toBe(0); expect(readFileSync(path, "utf8")).toBe(before);
  expect((await fetch(`${app.url}/api/providers/context`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) })).status).toBe(401);
});
