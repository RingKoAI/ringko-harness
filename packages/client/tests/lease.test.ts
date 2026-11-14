import { expect, it } from "bun:test";
import { attachFrontend, BackendClient } from "../src/index.ts";

const instance = "00000000-0000-0000-0000-000000000001", id = "00000000-0000-0000-0000-000000000002";
const grant = { id, instance, ttlMs: 100, heartbeatMs: 10 };
const identity = { protocol: 1, instance, workspace: "/fixture", configPath: null, lifecycle: { version: 1 } };

it("keeps one process lease alive with serialized heartbeats and releases it exactly once", async () => {
  const calls: string[] = []; let active = 0, maximum = 0;
  const client = new BackendClient({ fetch: async (url, init) => {
    calls.push(`${init?.method} ${url}`);
    if (String(url) === "/api/backend") return Response.json(identity);
    if (init?.method === "PUT") { active++; maximum = Math.max(active, maximum); await new Promise(resolve => setTimeout(resolve, 15)); active--; }
    return Response.json(grant);
  } });
  const lease = await attachFrontend(client, "cli"); await new Promise(resolve => setTimeout(resolve, 70));
  await Promise.all([lease.close(), lease.close()]); const count = calls.length;
  await new Promise(resolve => setTimeout(resolve, 40));
  expect(maximum).toBe(1); expect(calls.length).toBe(count);
  expect(calls.filter(call => call.startsWith("POST"))).toHaveLength(1);
  expect(calls.filter(call => call.startsWith("DELETE"))).toHaveLength(1);
});

it("reports lost ownership after bounded heartbeat failures instead of silently holding an expired lease", async () => {
  let failures = 0;
  const client = new BackendClient({ fetch: async (url, init) => {
    if (String(url) === "/api/backend") return Response.json(identity);
    if (init?.method === "PUT") { failures++; return Response.json({}, { status: 404 }); }
    return Response.json(grant);
  } });
  const lease = await attachFrontend(client, "web");
  try { expect((await lease.lost).message).toContain("connection was lost"); expect(failures).toBeGreaterThan(0); expect(failures).toBeLessThan(20); }
  finally { await lease.close(); }
});

it("recovers a transient heartbeat failure and accepts already closed release responses", async () => {
  let beats = 0;
  const client = new BackendClient({ fetch: async (url, init) => {
    if (String(url) === "/api/backend") return Response.json(identity);
    if (init?.method === "PUT" && ++beats === 1) return Response.json({}, { status: 500 });
    if (init?.method === "DELETE") return Response.json({}, { status: 503 });
    return Response.json(grant);
  } });
  const lease = await attachFrontend(client, "web"); await new Promise(resolve => setTimeout(resolve, 130));
  expect(beats).toBeGreaterThan(1); await lease.close();
});

it("rejects old protocol or invalid grants before scheduling heartbeat work", async () => {
  const old = new BackendClient({ fetch: async () => Response.json({ ...identity, lifecycle: undefined }) });
  await expect(attachFrontend(old, "cli")).rejects.toThrow("predates frontend lifecycle");
  for (const value of [null, {}, { ...grant, heartbeatMs: 0 }, { ...grant, ttlMs: 100_000 }, { ...grant, id: "../foreign" }]) {
    const client = new BackendClient({ fetch: async url => Response.json(String(url) === "/api/backend" ? identity : value) });
    await expect(attachFrontend(client, "cli")).rejects.toThrow("Invalid backend client lease");
  }
});

it("cleans an acquisition raced by a backend replacement and reports failed release", async () => {
  let deleted = 0;
  const client = new BackendClient({ fetch: async (url, init) => {
    if (String(url) === "/api/backend") return Response.json(identity);
    if (init?.method === "DELETE") { deleted++; return Response.json({}); }
    return Response.json({ ...grant, instance: id });
  } });
  await expect(attachFrontend(client, "web")).rejects.toThrow("Backend changed"); expect(deleted).toBe(1);
  const failed = new BackendClient({ fetch: async (url, init) => String(url) === "/api/backend" ? Response.json(identity) : init?.method === "DELETE" ? Response.json({}, { status: 500 }) : Response.json(grant) });
  const lease = await attachFrontend(failed, "cli"); await expect(lease.close()).rejects.toMatchObject({ status: 500 });
});

it("reports a refused local backend immediately and also bounds transient failure retries by TTL", async () => {
  for (const permanent of [false, true]) {
    let calls = 0;
    const client = new BackendClient({ fetch: async (url, init) => {
      if (String(url) === "/api/backend") return Response.json(identity);
      if (init?.method === "PUT") { calls++; if (permanent) throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" }); return Response.json({}, { status: 500 }); }
      return Response.json(grant);
    } });
    const lease = await attachFrontend(client, "cli"); await lease.lost; await lease.close();
    expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThan(20); if (permanent) expect(calls).toBe(1);
  }
});
