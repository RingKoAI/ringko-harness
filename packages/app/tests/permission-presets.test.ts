import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BackendClient } from "@ringko-ai/client";
import { loadConfig, saveConfig, settingsPath } from "@ringko-ai/config";
import { startServer, type RingkoServer } from "../src/server.ts";
let root: string, previous: string | undefined, app: RingkoServer, client: BackendClient;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rkh-preset-api-")); previous = process.env.RINGKO_HOME; process.env.RINGKO_HOME = join(root, "home");
  mkdirSync(join(root, ".git"));
  saveConfig({ permission: "approval", capabilities: { shell: true, network: false }, providers: [], sandbox: { mode: "workspace-write", additionalWritableRoots: [] } });
  app = startServer({ workspace: root, shared: true, port: 0, authToken: "fixture-token" }); client = new BackendClient({ url: app.url, workspace: root, token: "fixture-token" });
});
afterEach(async () => { await app.stop(); if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous; rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

it("applies three coherent presets, preserves disabled capabilities and reports actual custom legacy state", async () => {
  for (const [preset, permission, sandboxMode] of [["read-only", "approval", "read-only"], ["default", "approval", "workspace-write"], ["full-access", "full", "danger-full-access"]]) {
    const info = await client.request<{ permissionPreset: string; permission: string; sandboxMode: string; tools: string[] }>("/api/access", { preset });
    expect(info).toMatchObject({ permissionPreset: preset, permission, sandboxMode });
    const stored = loadConfig(); expect(stored.sandbox?.mode).toBe(sandboxMode); expect(stored.permission).toBe(permission);
    expect(stored.capabilities?.network).toBe(false); expect(info.tools).not.toContain("webfetch");
  }
  await client.request("/api/access", { preset: "default" });
  const legacy = await client.request<{ permissionPreset: string; sandboxMode: string }>("/api/access", { mode: "full" });
  expect(legacy).toMatchObject({ permissionPreset: "custom", sandboxMode: "workspace-write" });
});

it("rejects invalid and cross-origin switches without changing the stored configuration", async () => {
  const before = readFileSync(settingsPath(), "utf8");
  for (const body of [{ preset: "__proto__" }, { preset: "custom" }, { preset: "full-access", mode: "approval" }, { preset: null }]) await expect(client.request("/api/access", body)).rejects.toMatchObject({ status: 400 });
  const unauthorized = await fetch(`${app.url}/api/access`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"preset":"full-access"}' }); expect(unauthorized.status).toBe(401);
  const external = await fetch(`${app.url}/api/access`, { method: "POST", headers: { origin: "https://untrusted.invalid", authorization: "Bearer fixture-token", "content-type": "application/json" }, body: '{"preset":"full-access"}' }); expect(external.status).toBe(403);
  expect(readFileSync(settingsPath(), "utf8")).toBe(before);
});

it("refuses switching sandbox policy during a real accepted run", async () => {
  const source = join(root, "slow-model.ts");
  writeFileSync(source, 'export function createProviderClient() { return async () => { await new Promise(resolve => setTimeout(resolve, 500)); return { content: "done", toolCalls: [] }; }; }');
  saveConfig({ providers: [{ name: "fixture", type: "fixture", module: pathToFileURL(source).href, models: [{ id: "fixture", name: "Fixture", contextWindow: 128000, maxOutputTokens: 4096 }] }] });
  const run = await client.run({ prompt: "hold the mode" });
  expect((await client.snapshot(run.sessionId)).busy).toBe(true);
  await expect(client.request("/api/access", { preset: "full-access" })).rejects.toMatchObject({ status: 409 });
  await expect(client.request("/api/reload", {})).rejects.toMatchObject({ status: 409 });
  expect(loadConfig().sandbox?.mode).toBeUndefined();
  const deadline = Date.now() + 5000; while ((await client.snapshot(run.sessionId)).busy && Date.now() < deadline) await Bun.sleep(20);
  const info = await client.request<{ permissionPreset: string }>("/api/access", { preset: "read-only" }); expect(info.permissionPreset).toBe("read-only");
});

it("runs a read-only file exception only after live approval and leaves the configured preset unchanged", async () => {
  const source = join(root, "write-model.ts"), target = join(root, "approved.txt");
  writeFileSync(source, `export function createProviderClient() { return async request => request.messages.at(-1)?.role === "user" ? { content: "", toolCalls: [{ id: "approved-write", name: "write", arguments: { path: "approved.txt", content: "approved once" } }] } : { content: "done", toolCalls: [] }; }`);
  saveConfig({ providers: [{ name: "fixture", type: "fixture", module: pathToFileURL(source).href, models: [{ id: "fixture", name: "Fixture", contextWindow: 128000, maxOutputTokens: 4096 }] }] });
  await client.request("/api/access", { preset: "read-only" });
  const run = await client.run({ prompt: "request one write" });
  const deadline = Date.now() + 5000; let snapshot = await client.snapshot(run.sessionId);
  while (!snapshot.approvals.length && snapshot.busy && Date.now() < deadline) { await Bun.sleep(20); snapshot = await client.snapshot(run.sessionId); }
  expect(snapshot.approvals).toHaveLength(1);
  expect(() => readFileSync(target)).toThrow();
  await client.request("/api/approval", { id: snapshot.approvals[0]!.id, approved: true });
  while ((await client.snapshot(run.sessionId)).busy && Date.now() < deadline) await Bun.sleep(20);
  expect(readFileSync(target, "utf8")).toBe("approved once");
  expect(loadConfig()).toMatchObject({ permissionPreset: "read-only", permission: "approval", sandbox: { mode: "read-only" } });
});
