import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import bundled from "../models.metadata.json";
import { ModelCatalogCache, MODEL_CACHE_POLICY } from "../src/model-cache.ts";
import { MODEL_CATALOG_LIMITS, parseModelMetadata } from "../src/model-metadata.ts";

const payload = { fixture: { models: { cached: { name: "Cached", limit: { context: 262_144, output: 8192 } } } } };
const provider = { name: "fixture" }, model = { id: "cached", name: "Cached" };

describe("RingKo model catalog cache", () => {
  it("deduplicates refreshes, persists metadata and uses fresh disk data without another request", async () => {
    const root = mkdtempSync(join(tmpdir(), "ringko-catalog-"));
    let calls = 0, notifications = 0;
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => { calls++; return Response.json(payload); } });
    const options = { env: { RINGKO_HOME: root }, url: `http://127.0.0.1:${server.port}/api.json`, onError: () => {} };
    const cache = new ModelCatalogCache({ ...options, onRefresh: () => { expect(existsSync(cache.path)).toBe(true); notifications++; } });
    let restored: ModelCatalogCache | undefined;
    try {
      expect(await Promise.all([cache.refresh(true), cache.refresh(true), cache.refresh(true)])).toEqual([true, true, true]);
      expect(calls).toBe(1);
      expect(notifications).toBe(1);
      expect((await cache.find(provider, model))?.limit.context).toBe(262_144);
      restored = new ModelCatalogCache(options);
      expect((await restored.find(provider, model))?.limit.context).toBe(262_144);
      expect(await restored.refresh()).toBe(false);
      expect(calls).toBe(1);
    } finally { cache.dispose(); restored?.dispose(); server.stop(true); rmSync(root, { recursive: true, force: true }); }
  });

  it("keeps stale cache after malformed, oversized, redirected or offline refreshes", async () => {
    const root = mkdtempSync(join(tmpdir(), "ringko-catalog-failure-"));
    let mode = "valid", now = Date.now(), calls = 0;
    const errors: string[] = [];
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => {
      calls++;
      if (mode === "malformed") return new Response('{"fixture":');
      if (mode === "oversized") return new Response("large", { headers: { "content-length": String(MODEL_CATALOG_LIMITS.bytes + 1) } });
      if (mode === "redirect") return new Response(null, { status: 302, headers: { location: "/must-not-follow" } });
      return Response.json(payload);
    } });
    const cache = new ModelCatalogCache({ env: { RINGKO_HOME: root }, url: `http://127.0.0.1:${server.port}/api.json`, now: () => now, onError: message => errors.push(message) });
    try {
      expect(await cache.refresh(true)).toBe(true);
      const original = readFileSync(cache.path, "utf8");
      for (mode of ["malformed", "oversized", "redirect"]) {
        now += MODEL_CACHE_POLICY.ttl + 1;
        expect(await cache.refresh(true)).toBe(false);
        expect((await cache.find(provider, model))?.limit.context).toBe(262_144);
        expect(readFileSync(cache.path, "utf8")).toBe(original);
      }
      expect(calls).toBe(4);
      expect(errors).toHaveLength(3);
      server.stop(true);
      expect(await cache.refresh(true)).toBe(false);
      expect((await cache.find(provider, model))?.limit.context).toBe(262_144);
    } finally { cache.dispose(); server.stop(true); rmSync(root, { recursive: true, force: true }); }
  });

  it("uses the bundled snapshot after a corrupt cache and keeps successful downloads unpublished when disk writes fail", async () => {
    const root = mkdtempSync(join(tmpdir(), "ringko-catalog-disk-"));
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json(payload) });
    const options = { env: { RINGKO_HOME: root }, url: `http://127.0.0.1:${server.port}/api.json`, onError: () => {} };
    const cache = new ModelCatalogCache(options);
    let blocked: ModelCatalogCache | undefined;
    try {
      mkdirSync(dirname(cache.path), { recursive: true });
      writeFileSync(cache.path, "broken JSON");
      cache.dispose();
      const directory = parseModelMetadata(bundled);
      const [providerId, entry] = Object.entries(directory)[0];
      const [first] = Object.values(entry.models);
      expect(await cache.find({ name: providerId }, { id: first.id, name: first.id })).toEqual(first);
      const otherRoot = join(root, "blocked");
      blocked = new ModelCatalogCache({ ...options, env: { RINGKO_HOME: otherRoot } });
      mkdirSync(dirname(dirname(blocked.path)), { recursive: true });
      writeFileSync(dirname(blocked.path), "not a directory");
      expect(await blocked.refresh(true)).toBe(false);
      expect(await blocked.find(provider, model)).toBeUndefined();
    } finally { cache.dispose(); blocked?.dispose(); server.stop(true); rmSync(root, { recursive: true, force: true }); }
  });

  it("separates source URLs and aborts a pending refresh on disposal", async () => {
    const root = mkdtempSync(join(tmpdir(), "ringko-catalog-stop-"));
    let started!: () => void;
    const requested = new Promise<void>(resolve => { started = resolve; });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async () => { started(); await gate; return Response.json(payload); } });
    const cache = new ModelCatalogCache({ env: { RINGKO_HOME: root }, url: `http://127.0.0.1:${server.port}/api.json`, onError: () => {} });
    const other = new ModelCatalogCache({ env: { RINGKO_HOME: root }, url: `http://127.0.0.1:${server.port}/other.json`, onError: () => {} });
    try {
      expect(cache.path).not.toBe(other.path);
      const pending = cache.refresh(true);
      await requested;
      cache.dispose();
      expect(await pending).toBe(false);
      expect(existsSync(cache.path)).toBe(false);
    } finally { release(); cache.dispose(); other.dispose(); server.stop(true); rmSync(root, { recursive: true, force: true }); }
  });
});
