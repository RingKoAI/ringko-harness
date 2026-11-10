import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { saveConfig, saveConfigFile, setApiKey } from "@ringko-ai/config";
import type { RuntimeStatus } from "@ringko-ai/client";
import { startServer, type RingkoServer } from "../src/server.ts";
import { RuntimeSupervisor } from "@ringko-ai/sdk/runtime";

let root: string, configPath: string, app: RingkoServer, previous: { home?: string; agents?: string };
let host: RuntimeSupervisor;
const token = "status-host-secret";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rkh-status-")); configPath = join(root, "explicit.json");
  previous = { home: process.env.RINGKO_HOME, agents: process.env.AGENTS_HOME };
  process.env.RINGKO_HOME = join(root, "home"); process.env.AGENTS_HOME = join(root, "agents");
  saveConfig({ thinking: "off", updates: { checkOnStartup: false } });
  setApiKey("Fixture", "stored-auth-secret");
  saveConfigFile({ model: "Fixture/model", providers: [{ name: "Fixture", type: "openai-compatible", module: "missing-module-must-not-be-imported", baseURL: "https://url-user:url-password@example.invalid/v1?key=query-secret#fragment-secret", apiKey: "provider-key-secret", models: [{ id: "model", name: "Real Model" }] }] }, configPath);
  host = new RuntimeSupervisor({ configPath });
  app = startServer({ workspace: root, port: 0, configPath, authToken: token, version: "1.2.3", runtimeHost: host });
});
afterEach(async () => {
  await app.stop();
  if (previous.home === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous.home;
  if (previous.agents === undefined) delete process.env.AGENTS_HOME; else process.env.AGENTS_HOME = previous.agents;
  rmSync(root, { recursive: true, force: true });
});
const request = () => fetch(`${app.url}/api/status`, { headers: { authorization: `Bearer ${token}` } });

it("returns authoritative read-only status without importing models or leaking secrets", async () => {
  const response = await request(); expect(response.status).toBe(200);
  const report = await response.json() as RuntimeStatus;
  const rows = Object.fromEntries(report.entries.map(entry => [entry.label, entry.value]));
  expect(report.version).toBe("1.2.3");
  expect(rows).toMatchObject({ cwd: root, "Setting sources": resolve(configPath), "Configured URL": "https://example.invalid/v1", "Auth configuration": "Provider settings", "Startup update check": "Enabled", "Automatic updates": "Disabled", "MCP servers": "0 connected, 0 failed · /mcp" });
  expect(rows.Model).toContain("Real Model");
  for (const secret of [token, "stored-auth-secret", "provider-key-secret", "url-user", "url-password", "query-secret", "fragment-secret"]) expect(JSON.stringify(report)).not.toContain(secret);
  const sessions = await fetch(`${app.url}/api/sessions`, { headers: { authorization: `Bearer ${token}` } });
  expect(await sessions.json()).toEqual([]);
});

it("guards diagnostics with backend authentication, origin and workspace checks", async () => {
  expect((await fetch(`${app.url}/api/status`)).status).toBe(401);
  expect((await fetch(`${app.url}/api/status`, { headers: { authorization: `Bearer ${token}`, origin: "https://unrelated.invalid" } })).status).toBe(403);
  expect((await fetch(`${app.url}/api/status`, { headers: { authorization: `Bearer ${token}`, "x-ringko-workspace": encodeURIComponent(join(root, "other")) } })).status).toBe(409);
});

it("redacts configuration failures and does not replace the invalid file", async () => {
  const broken = '{"apiKey":"bad-config-secret",'; writeFileSync(configPath, broken);
  const response = await request(); expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("bad-config-secret");
  expect(readFileSync(configPath, "utf8")).toBe(broken);
});

it("counts MCP failures without copying connector errors into the report", async () => {
  host.get(root).readyConnections = async () => ({ connections: [], errors: [{ name: "private-connector", message: "mcp-auth-secret" }] });
  const response = await request(); expect(response.status).toBe(200);
  const status = await response.json() as RuntimeStatus;
  expect(status.entries.find(entry => entry.label === "MCP servers")?.value).toBe("0 connected, 1 failed · /mcp");
  expect(JSON.stringify(status)).not.toContain("mcp-auth-secret");
  host.get(root).readyConnections = async () => { throw new Error("private-startup-secret"); };
  const unavailable = await request(); expect(unavailable.status).toBe(500);
  expect(await unavailable.text()).not.toContain("private-startup-secret");
});

it("rejects a status snapshot whose workspace changes while discovery settles", async () => {
  const pending = Promise.withResolvers<{ connections: []; errors: [] }>(), entered = Promise.withResolvers<void>();
  host.get(root).readyConnections = () => { entered.resolve(); return pending.promise; };
  const status = request();
  try {
    await entered.promise;
    const other = join(root, "other"); mkdirSync(other);
    const switched = await fetch(`${app.url}/api/projects`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ path: other }) });
    expect(switched.status).toBe(200);
    pending.resolve({ connections: [], errors: [] });
    expect((await status).status).toBe(409);
  } finally { pending.resolve({ connections: [], errors: [] }); }
});
