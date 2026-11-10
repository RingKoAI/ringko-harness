import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { configurationStatus, statusEndpoint } from "../src/status.ts";
import { saveConfig, type RingkoConfig } from "../src/config.ts";
import { setApiKey } from "../src/auth.ts";
import { providerPath, settingsPath } from "../src/paths.ts";

let root: string, previous: string | undefined;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "rkh-status-config-")); previous = process.env.RINGKO_HOME; process.env.RINGKO_HOME = root; });
afterEach(() => { if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous; rmSync(root, { recursive: true, force: true }); });
const rows = (config: RingkoConfig, extra: { path?: string; embedded?: boolean } = {}) => Object.fromEntries(configurationStatus(config, { ...extra, warn: () => {} }).map(entry => [entry.label, entry.value]));

it("distinguishes default, user, explicit and embedded setting sources", () => {
  expect(rows({})).toMatchObject({ Model: "Offline echo (default)", "Setting sources": "Defaults (no settings files)", "Access mode": "approval" });
  saveConfig({});
  const sources = rows({})["Setting sources"];
  expect(sources).toContain(settingsPath()); expect(sources).toContain(providerPath());
  const path = join(root, "active.json");
  expect(rows({}, { path })["Setting sources"]).toBe(resolve(path));
  expect(rows({}, { embedded: true })["Setting sources"]).toBe("Host-provided configuration");
});

it("shows credential location without returning configured or stored credential values", () => {
  const config: RingkoConfig = { providers: [{ name: "Fixture", type: "echo", models: [{ name: "Model", id: "model" }] }] };
  expect(rows(config)["Auth configuration"]).toContain("Provider-managed");
  expect(rows({ providers: [{ name: "__proto__", models: [{ name: "Model", id: "model" }] }] })["Auth configuration"]).toContain("Provider-managed");
  setApiKey("Fixture", "stored-private-key");
  expect(rows(config)["Auth configuration"]).toBe("Auth store");
  config.providers![0]!.apiKey = "configured-private-key";
  expect(rows(config)["Auth configuration"]).toBe("Provider settings");
  const serialized = JSON.stringify(rows(config));
  expect(serialized).not.toContain("stored-private-key"); expect(serialized).not.toContain("configured-private-key");
});

it("hides URL credentials and malformed/non-HTTP endpoint contents", () => {
  expect(statusEndpoint(undefined)).toBe("Provider default");
  expect(statusEndpoint("https://user:secret@example.invalid/v1?token=private#hidden")).toBe("https://example.invalid/v1");
  expect(statusEndpoint("file:///private-key")).toBe("Configured (URL hidden)");
  expect(statusEndpoint("invalid-with-private-key")).toBe("Configured (invalid URL hidden)");
});

it("reports inactive automatic updates, invalid defaults and bounded metadata", () => {
  const warnings: string[] = [];
  const config: RingkoConfig = { mode: "full", updates: { checkOnStartup: false, autoUpdate: true }, workflow: "x".repeat(5000) };
  expect(rows(config)["Automatic updates"]).toContain("inactive");
  expect(rows(config)["Access mode"]).toBe("full");
  expect(rows(config)["Workflow setting"].length).toBe(4096);
  configurationStatus({ updates: [] as never }, { warn: warning => warnings.push(warning) });
  expect(warnings).toHaveLength(1);
  expect(() => rows({ thinking: false as never })).toThrow("Invalid status configuration");
});
