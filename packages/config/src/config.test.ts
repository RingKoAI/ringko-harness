import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getConfigValue, loadConfig, parseConfigValue, saveConfig, setConfigValue, unsetConfigValue } from "./config.ts";
import { providerPath, settingsPath } from "./paths.ts";

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
    writeFileSync(providerPath(env), JSON.stringify({ provider: { name: "openai", model: "gpt-4o-mini" } }));

    const config = loadConfig({ env });
    expect(config.workspace).toBe(".");
    expect(config.capabilities?.shell).toBe(true);
    expect(config.provider?.model).toBe("gpt-4o-mini");
  });

  it("accepts a bare provider object", () => {
    mkdirSync(join(home, ".ringko"), { recursive: true });
    writeFileSync(providerPath(env), JSON.stringify({ file: "providers.json", entry: "x", model: "m" }));
    expect(loadConfig({ env }).provider?.entry).toBe("x");
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
  it("splits providers and settings into their files", () => {
    const written = saveConfig({ workspace: ".", provider: { name: "openai", model: "gpt-4o-mini" } }, env);

    expect(written).toEqual([settingsPath(env), providerPath(env)]);
    expect(JSON.parse(readFileSync(settingsPath(env), "utf8"))).toEqual({ workspace: "." });
    expect(JSON.parse(readFileSync(providerPath(env), "utf8"))).toEqual({
      provider: { name: "openai", model: "gpt-4o-mini" },
    });
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
