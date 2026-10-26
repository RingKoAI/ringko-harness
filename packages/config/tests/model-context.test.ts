import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelCatalogCache, modelCatalogUrl } from "../src/model-cache.ts";
import { resolveSelectionContext } from "../src/model-context.ts";
import { isLocalModelHost, isLoopbackHost } from "../src/network-address.ts";
import { DEFAULT_CONTEXT_LIMITS } from "../src/context.ts";

it("recognizes private deployments and permits plaintext mirrors only on loopback", () => {
  for (const host of ["localhost", "127.0.0.2", "[::1]", "10.1.2.3", "172.16.1.2", "172.31.2.3", "192.168.1.1", "169.254.1.1", "model.local", "[fd00::1]", "[fe80::1]", "[::ffff:c0a8:101]"]) expect(isLocalModelHost(host)).toBe(true);
  for (const host of ["172.15.1.2", "172.32.1.2", "8.8.8.8", "api.example.com"]) expect(isLocalModelHost(host)).toBe(false);
  expect(isLoopbackHost("[::ffff:7f00:1]")).toBe(true);
  expect(modelCatalogUrl({ RINGKO_MODELS_URL: "http://127.0.0.1:3000/api.json" })).toContain("127.0.0.1");
  expect(() => modelCatalogUrl({ RINGKO_MODELS_URL: "http://catalog.example.com/api.json" })).toThrow("HTTPS");
  expect(() => modelCatalogUrl({ RINGKO_MODELS_URL: "http://192.168.1.1/api.json" })).toThrow("HTTPS");
});

it("skips public catalog lookups for private endpoints unless explicitly mapped", async () => {
  const root = mkdtempSync(join(tmpdir(), "ringko-private-context-"));
  let calls = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => { calls++; return Response.json({ fixture: { models: { mapped: { limit: { context: 262_144 } } } } }); } });
  const cache = new ModelCatalogCache({ env: { RINGKO_HOME: root }, url: `http://127.0.0.1:${server.port}/api.json`, onError: () => {} });
  try {
    const selection = { provider: { name: "Local", type: "openai-compatible", baseURL: "http://192.168.1.1/v1" }, model: { id: "local-alias", name: "Local" } };
    expect(await resolveSelectionContext(selection, cache)).toEqual(DEFAULT_CONTEXT_LIMITS);
    expect(calls).toBe(0);
    expect(await cache.refresh(true)).toBe(true);
    expect((await resolveSelectionContext({ ...selection, model: { ...selection.model, catalogId: "fixture/mapped" } }, cache)).contextWindow).toBe(262_144);
  } finally { cache.dispose(); server.stop(true); rmSync(root, { recursive: true, force: true }); }
});
