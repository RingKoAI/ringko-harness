import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig, settingsPath } from "@ringko-ai/config";
import { startServer, type RingkoServer } from "../src/server.ts";

let root: string, previousHome: string | undefined, app: RingkoServer;
const token = "update-settings-test-token";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rkh-update-settings-"));
  previousHome = process.env.RINGKO_HOME; process.env.RINGKO_HOME = join(root, "home");
  saveConfig({ thinking: "low", providers: [] });
  app = startServer({ workspace: root, port: 0, shared: true, authToken: token });
});
afterEach(async () => {
  await app.stop();
  if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
  rmSync(root, { recursive: true, force: true });
});
const info = async () => (await fetch(`${app.url}/api/info`)).json() as Promise<{ updates: { checkOnStartup: boolean; autoUpdate: boolean } }>;
const save = (body: unknown) => fetch(`${app.url}/api/updates`, {
  method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
});

it("reports CLI defaults and persists independent partial updates across restarts", async () => {
  expect((await info()).updates).toEqual({ checkOnStartup: true, autoUpdate: false });
  const enabled = await save({ autoUpdate: true }); expect(enabled.status).toBe(200);
  expect((await enabled.json()).updates).toEqual({ checkOnStartup: true, autoUpdate: true });
  const disabled = await save({ checkOnStartup: false }); expect(disabled.status).toBe(200);
  expect((await disabled.json()).updates).toEqual({ checkOnStartup: false, autoUpdate: true });
  expect(loadConfig()).toMatchObject({ thinking: "low", updates: { checkOnStartup: false, autoUpdate: true } });
  await app.stop();
  app = startServer({ workspace: root, port: 0, shared: true, authToken: token });
  expect((await info()).updates).toEqual({ checkOnStartup: false, autoUpdate: true });
});

it("rejects malformed patches without changing configuration and reports invalid-value defaults", async () => {
  saveConfig({ updates: { checkOnStartup: "false" as unknown as boolean, autoUpdate: null as unknown as boolean }, thinking: "low" });
  expect((await info()).updates).toEqual({ checkOnStartup: true, autoUpdate: false });
  const before = readFileSync(settingsPath(), "utf8");
  for (const body of [null, [], {}, { autoUpdate: "true" }, { checkOnStartup: 0 }, { autoUpdate: null }, { autoUpdate: true, workspace: "elsewhere" }]) {
    expect((await save(body)).status).toBe(400);
    expect(readFileSync(settingsPath(), "utf8")).toBe(before);
  }
  const malformed = await fetch(`${app.url}/api/updates`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{" });
  expect(malformed.status).toBe(400);
  expect(readFileSync(settingsPath(), "utf8")).toBe(before);
  expect((await save({ checkOnStartup: false })).status).toBe(200);
  expect((await info()).updates).toEqual({ checkOnStartup: false, autoUpdate: false });
});

it("requires authentication and the existing origin and workspace boundaries for update changes", async () => {
  const before = readFileSync(settingsPath(), "utf8");
  const body = JSON.stringify({ autoUpdate: true });
  const anonymous = await fetch(`${app.url}/api/updates`, { method: "POST", headers: { "content-type": "application/json" }, body });
  expect(anonymous.status).toBe(401);
  for (const [headers, status] of [[{ origin: "https://unrelated.invalid" }, 403], [{ "x-ringko-workspace": encodeURIComponent(join(root, "another-workspace")) }, 409]] as const) {
    const response = await fetch(`${app.url}/api/updates`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers }, body });
    expect(response.status).toBe(status);
  }
  expect(readFileSync(settingsPath(), "utf8")).toBe(before);
});

it("does not replace an unreadable existing configuration with defaults", async () => {
  writeFileSync(settingsPath(), "{ invalid configuration");
  const response = await save({ autoUpdate: true });
  expect(response.status).toBe(500);
  expect(readFileSync(settingsPath(), "utf8")).toBe("{ invalid configuration");
});
