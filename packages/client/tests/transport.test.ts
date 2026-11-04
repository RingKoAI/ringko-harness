import { expect, it } from "bun:test";
import { BackendClient, BackendError, consumeSse } from "../src/index.ts";
import { SYNC_LIMITS } from "@ringko-ai/protocol";

it("decodes split CRLF frames, multiline JSON and heartbeat comments", async () => {
  const chunks = [": heartbeat\r\n\r\nevent: sync\r", '\ndata: {"instance":"one",\r\ndata: "revision":1}\r\n\r', "\n"];
  const response = new Response(new ReadableStream({ start(controller) { for (const value of chunks) controller.enqueue(new TextEncoder().encode(value)); controller.close(); } }));
  const events: unknown[] = [];
  await consumeSse(response, (event, value) => events.push({ event, value }));
  expect(events).toEqual([{ event: "sync", value: { instance: "one", revision: 1 } }]);
});

it("rejects oversized event frames and cancels the consumer", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(SYNC_LIMITS.frameBytes + 1))); }, cancel() { cancelled = true; } }));
  await expect(consumeSse(response, () => {})).rejects.toThrow("size limit");
  expect(cancelled).toBe(true);
});

it("sends refreshed credentials and rejects unauthenticated requests without following redirects", async () => {
  let token = "first";
  const headers: string[] = [];
  const client = new BackendClient({ token: () => token, fetch: (async (_url: unknown, init?: RequestInit) => {
    headers.push(new Headers(init?.headers).get("authorization") ?? "");
    expect(init?.redirect).toBe("error");
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }) });
  await expect(client.sessions()).rejects.toBeInstanceOf(BackendError);
  token = "second";
  await expect(client.sessions()).rejects.toThrow("unauthorized");
  expect(headers).toEqual(["Bearer first", "Bearer second"]);
});

it("exposes typed skill and plugin endpoints", async () => {
  const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
  const client = new BackendClient({ fetch: (async (url: unknown, init?: RequestInit) => {
    calls.push({ path: String(url), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return Response.json(String(url).endsWith("/api/plugins") ? { plugins: [], candidates: [], errors: [] } : []);
  }) });
  await client.skills();
  await client.createSkill({ name: "demo" });
  await client.installSkill({ source: "/tmp/demo", scope: "project" });
  await client.removeSkill("/tmp/demo");
  await client.plugins();
  await client.trustPlugin("demo");
  await client.untrustPlugin("demo");
  expect(calls).toEqual([
    { path: "/api/skills", method: "GET", body: undefined },
    { path: "/api/skills", method: "POST", body: { name: "demo" } },
    { path: "/api/skills/install", method: "POST", body: { source: "/tmp/demo", scope: "project" } },
    { path: "/api/skills/remove", method: "POST", body: { dir: "/tmp/demo" } },
    { path: "/api/plugins", method: "GET", body: undefined },
    { path: "/api/plugins/trust", method: "POST", body: { name: "demo" } },
    { path: "/api/plugins/untrust", method: "POST", body: { name: "demo" } },
  ]);
});

it("stops reconnecting and releases the stream after a watch is closed", async () => {
  let calls = 0; let cancelled = false;
  const client = new BackendClient({ fetch: (async () => {
    calls++;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('event: sync\ndata: {"kind":"reset","instance":"one","revision":0}\n\n')); }, cancel() { cancelled = true; } }));
  }) });
  let received!: () => void;
  const ready = new Promise<void>(resolve => { received = resolve; });
  const watch = client.watch(() => received());
  await ready; watch.close();
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(cancelled).toBe(true); expect(calls).toBe(1);
});
