import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getConfigValue,
  loadConfig,
  parseConfigValue,
  saveConfig,
  setConfigValue,
  unsetConfigValue,
  upsertProviderModels,
} from "../src/config.ts";
import { providerPath, settingsPath } from "../src/paths.ts";

let home: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ringko-config-"));
  env = { RINGKO_HOME: home } as NodeJS.ProcessEnv;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns an empty config when the files are missing", () => {
    expect(loadConfig({ env })).toEqual({});
  });

  it("tolerates empty placeholder files", () => {
    mkdirSync(join(home, ".ringko"), { recursive: true });
    writeFileSync(settingsPath(env), "");
    writeFileSync(providerPath(env), "");
    expect(loadConfig({ env })).toEqual({});
  });

  it("merges settings and the provider file", () => {
    mkdirSync(join(home, ".ringko"), { recursive: true });
    writeFileSync(settingsPath(env), JSON.stringify({ workspace: ".", capabilities: { shell: true } }));
    writeFileSync(
      providerPath(env),
      JSON.stringify({
        model: "openai/gpt-4o-mini",
        providers: [{ name: "openai", type: "openai", models: [{ id: "gpt-4o-mini", name: "GPT-4o mini" }] }],
      }),
    );

    const config = loadConfig({ env });
    expect(config.workspace).toBe(".");
    expect(config.capabilities?.shell).toBe(true);
    expect(config.model).toBe("openai/gpt-4o-mini");
    expect(config.providers?.[0]?.type).toBe("openai");
  });

  it("rejects invalid JSON and non-object roots", () => {
    mkdirSync(join(home, ".ringko"), { recursive: true });
    writeFileSync(settingsPath(env), "{");
    expect(() => loadConfig({ env })).toThrow("not valid JSON");

    writeFileSync(settingsPath(env), "[]");
    expect(() => loadConfig({ env })).toThrow("must be a JSON object");
  });

  it("throws when an explicit file is missing", () => {
    expect(() => loadConfig({ path: join(home, "missing.json") })).toThrow("Cannot read config");
  });
});

describe("saveConfig", () => {
  it("splits providers/selection from settings", () => {
    const written = saveConfig(
      {
        workspace: ".",
        model: "openai/gpt-4o-mini",
        providers: [{ name: "openai", type: "openai", models: [{ id: "gpt-4o-mini", name: "GPT-4o mini" }] }],
      },
      env,
    );

    expect(written).toEqual([settingsPath(env), providerPath(env)]);
    expect(JSON.parse(readFileSync(settingsPath(env), "utf8"))).toEqual({ workspace: "." });
    expect(JSON.parse(readFileSync(providerPath(env), "utf8"))).toEqual({
      model: "openai/gpt-4o-mini",
      small_model: "",
      providers: [{ name: "openai", type: "openai", models: [{ id: "gpt-4o-mini", name: "GPT-4o mini" }] }],
    });
  });
});

describe("upsertProviderModels", () => {
  it("creates a provider and selects its first model", () => {
    const config = upsertProviderModels({}, "openai", "openai-oauth", [{ id: "gpt-6-sol", name: "GPT-6 Sol" }]);
    expect(config.providers?.[0]?.name).toBe("openai");
    expect(config.providers?.[0]?.type).toBe("openai-oauth");
    expect(config.model).toBe("openai/gpt-6-sol");
  });

  it("merges new models without duplicating or overwriting the selection", () => {
    const base = upsertProviderModels({ model: "openai/gpt-6-sol" }, "openai", "openai-oauth", [
      { id: "gpt-6-sol", name: "GPT-6 Sol" },
    ]);
    const next = upsertProviderModels(base, "openai", "openai-oauth", [
      { id: "gpt-6-sol", name: "GPT-6 Sol" },
      { id: "gpt-5.5", name: "GPT-5.5" },
    ]);
    expect(next.providers?.[0]?.models?.map((model) => model.id)).toEqual(["gpt-6-sol", "gpt-5.5"]);
    expect(next.model).toBe("openai/gpt-6-sol");
  });
});

describe("dotted access", () => {
  it("sets, gets, and unsets nested keys", () => {
    const withValue = setConfigValue({}, "provider.apiKey", "test-key");
    expect(getConfigValue(withValue, "provider.apiKey")).toBe("test-key");
    expect(getConfigValue(withValue, "provider.model")).toBeUndefined();
    expect(getConfigValue(unsetConfigValue(withValue, "provider.apiKey"), "provider.apiKey")).toBeUndefined();
  });

  it("parses JSON values and falls back to strings", () => {
    expect(parseConfigValue("true")).toBe(true);
    expect(parseConfigValue("42")).toBe(42);
    expect(parseConfigValue("plain")).toBe("plain");
  });
});
