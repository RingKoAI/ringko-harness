import { afterEach, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SessionStore } from "@ringko-ai/session";
import { BackendClient, attachFrontend, CLIENT_LEASE_LIMITS } from "@ringko-ai/client";
import { ClientLifecycle } from "../src/services/client-lifecycle.ts";
import { startServer, type RingkoServer } from "../src/server.ts";
import { readBackendRegistration, saveConfig } from "@ringko-ai/config";

it("tracks process leases independently, enables only Web owners, and closes only after the last owner", () => {
  let now = 0; const lifecycle = new ClientLifecycle("fixture", { managed: true, now: () => now });
  expect(lifecycle.status()).toMatchObject({ managed: true, clients: 0, webui: false });
  expect(lifecycle.shouldClose(false)).toBe(false);
  const cli = lifecycle.acquire("cli"), web = lifecycle.acquire("web");
  expect(lifecycle.status()).toMatchObject({ cli: 1, web: 1, clients: 2, webui: true });
  lifecycle.release(cli.id); lifecycle.release(cli.id); now += 2000;
  expect(lifecycle.shouldClose(false)).toBe(false);
  lifecycle.release(web.id); expect(lifecycle.status().webui).toBe(false);
  now += CLIENT_LEASE_LIMITS.idleGraceMs - 1; expect(lifecycle.shouldClose(false)).toBe(false);
  now++; expect(lifecycle.shouldClose(false)).toBe(true);
});

it("renews leases, expires crashed clients, and lets a new client win during the shutdown grace period", () => {
  let now = 0; const lifecycle = new ClientLifecycle("fixture", { managed: true, now: () => now });
  const lease = lifecycle.acquire("web"); now = 10_000; expect(lifecycle.renew(lease.id)).toBeDefined();
  now = 24_999; expect(lifecycle.status().web).toBe(1); now++;
  expect(lifecycle.status().web).toBe(0); expect(lifecycle.renew(lease.id)).toBeUndefined();
  expect(lifecycle.shouldClose(false)).toBe(false);
  const replacement = lifecycle.acquire("cli"); now += 5000; expect(lifecycle.shouldClose(false)).toBe(false);
  lifecycle.release(replacement.id); now += 1000; expect(lifecycle.shouldClose(true)).toBe(false);
  now += 999; expect(lifecycle.shouldClose(false)).toBe(false); now++; expect(lifecycle.shouldClose(false)).toBe(true);
});

it("bounds client count, rejects invalid kinds and limits, and preserves explicit persistent hosts", () => {
  let now = 0; const lifecycle = new ClientLifecycle("fixture", { managed: true, now: () => now });
  for (let index = 0; index < CLIENT_LEASE_LIMITS.clients; index++) lifecycle.acquire("cli");
  expect(() => lifecycle.acquire("web")).toThrow("Too many");
  expect(() => lifecycle.acquire("invalid" as "cli")).toThrow("Invalid frontend");
  expect(() => new ClientLifecycle("fixture", { limits: { ttlMs: 0 } })).toThrow("Invalid client");
  now += 60_000; lifecycle.pin(); expect(lifecycle.shouldClose(false)).toBe(false);
  const persistent = new ClientLifecycle("fixture", { now: () => now }); now += 60_000;
  expect(persistent.shouldClose(false)).toBe(false); expect(persistent.status().webui).toBe(true);
  const unattached = new ClientLifecycle("fixture", { managed: true, now: () => now }); now += CLIENT_LEASE_LIMITS.startupGraceMs;
  expect(unattached.shouldClose(false)).toBe(true);
});

let app: RingkoServer | undefined, root: string | undefined, previous: string | undefined;
afterEach(async () => { await app?.stop(); app = undefined; if (root) { if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous; rmSync(root, { recursive: true, force: true }); root = undefined; } });
function setup(token?: string) {
  root = mkdtempSync(join(tmpdir(), "rkh-client-lifecycle-")); previous = process.env.RINGKO_HOME; process.env.RINGKO_HOME = root;
  saveConfig({ providers: [], updates: { checkOnStartup: false } });
  writeFileSync(join(root, "index.html"), "Lifecycle Web fixture");
  app = startServer({ workspace: root, port: 0, managed: true, authToken: token, webuiDir: root, clientLeaseLimits: { idleGraceMs: 50, ttlMs: 200, heartbeatMs: 40, startupGraceMs: 1000 } });
  return new BackendClient({ url: app.url, workspace: root, token });
}

it("keeps the same engine alive when CLI exits before Web, and shuts down after Web exits", async () => {
  const client = setup(), instance = (await client.identity()).instance;
  expect((await fetch(app!.url)).status).toBe(404);
  const cli = await attachFrontend(client, "cli"), web = await attachFrontend(client, "web");
  expect((await client.identity()).lifecycle).toMatchObject({ cli: 1, web: 1, webui: true });
  expect(await (await fetch(app!.url)).text()).toBe("Lifecycle Web fixture");
  await cli.close(); await Bun.sleep(250);
  expect((await client.identity()).instance).toBe(instance); expect((await client.identity()).lifecycle?.web).toBe(1);
  await web.close(); await app!.closed;
  await expect(client.identity()).rejects.toThrow(); expect(readBackendRegistration(root!)).toBeUndefined();
});

it("disables pages when Web exits first and expires a crashed last client", async () => {
  const client = setup(), cli = await attachFrontend(client, "cli"), web = await attachFrontend(client, "web");
  await web.close(); expect((await fetch(app!.url)).status).toBe(404);
  await cli.close();
  const grant = await client.request<{ id: string }>("/api/backend/clients", { kind: "web" });
  expect(grant.id).toBeDefined(); await app!.closed;
  await expect(client.identity()).rejects.toThrow();
});

it("protects lifecycle mutations with authentication, origin checks and strict lease inputs", async () => {
  const client = setup("fixture-token");
  expect((await fetch(`${app!.url}/api/backend/clients`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"kind":"web"}' })).status).toBe(401);
  expect((await fetch(`${app!.url}/api/backend/clients`, { method: "POST", headers: { origin: "https://untrusted.invalid", "content-type": "application/json" }, body: '{"kind":"web"}' })).status).toBe(403);
  await expect(client.request("/api/backend/clients", { kind: "other" })).rejects.toMatchObject({ status: 400 });
  await expect(client.request("/api/backend/clients/not-a-lease", {}, "PUT")).rejects.toMatchObject({ status: 404 });
  const lease = await attachFrontend(client, "cli"); await lease.close();
});

it("lets accepted runs finish after the last frontend leaves before shutting down", async () => {
  const client = setup(), modulePath = join(root!, "model.ts");
  writeFileSync(modulePath, `export function createProviderClient() { return async request => { if (request.messages.at(-1)?.content === "keep work") await new Promise(resolve => setTimeout(resolve, 1200)); return { content: "finished", toolCalls: [] }; }; }`);
  saveConfig({ model: "fixture/model", providers: [{ name: "fixture", type: "fixture", module: pathToFileURL(modulePath).href, models: [{ id: "model", name: "model", contextWindow: 128000, maxOutputTokens: 4096 }] }] });
  const cli = await attachFrontend(client, "cli"), run = await client.run({ prompt: "keep work" });
  expect((await client.snapshot(run.sessionId)).busy).toBe(true);
  await cli.close(); await Bun.sleep(550);
  expect((await client.identity()).lifecycle?.clients).toBe(0);
  expect((await client.snapshot(run.sessionId)).busy).toBe(true);
  await app!.closed;
  const session = new SessionStore({ cwd: root! }).open(run.sessionId, "read");
  try { expect(session.all().some(event => event.type === "run/completed")).toBe(true); expect(session.all().some(event => event.type === "run/cancelled")).toBe(false); }
  finally { session.close(); }
});

it("pins the workspace only while a CLI owns it and preserves the Web lease across Web-only project switches", async () => {
  const client = setup(), cli = await attachFrontend(client, "cli"), web = await attachFrontend(client, "web");
  const target = join(root!, "other"); mkdirSync(target);
  const projects = await client.request<{ projects: { id: string }[] }>("/api/projects", { path: target });
  await expect(client.request(`/api/projects/${projects.projects[0]!.id}/current`, {})).rejects.toMatchObject({ status: 409 });
  await cli.close(); await client.request(`/api/projects/${projects.projects[0]!.id}/current`, {});
  await Bun.sleep(250);
  // The Web owner's original workspace header must not invalidate its lease.
  const current = new BackendClient({ url: app!.url, workspace: target });
  expect((await current.identity()).lifecycle?.web).toBe(1);
  await web.close(); await app!.closed;
});

it("keeps explicitly pinned service backends alive without opening a Web frontend", async () => {
  const client = setup(), cli = await attachFrontend(client, "cli");
  await client.request("/api/backend/persist", {}); await cli.close(); await Bun.sleep(600);
  expect((await client.identity()).lifecycle).toMatchObject({ managed: false, clients: 0, webui: false });
});
