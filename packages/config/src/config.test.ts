import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configPath,
  getConfigValue,
  loadConfig,
  parseConfigValue,
  saveConfig,
  setConfigValue,
  unsetConfigValue,
} from "./config.ts";

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
  it("returns an empty config when missing", () => {
    expect(loadConfig({ env })).toEqual({});
  });

  it("throws when an explicit file is missing", () => {
    expect(() => loadConfig({ path: join(home, "missing.json") })).toThrow("Cannot read config");
  });

  it("parses a saved config", () => {
    saveConfig({ provider: { name: "openai", model: "gpt-4o-mini" } }, env);
    expect(loadConfig({ env }).provider?.name).toBe("openai");
  });

  it("rejects invalid JSON and non-object roots", () => {
    mkdirSync(join(home, ".ringko"), { recursive: true });
    writeFileSync(configPath(env), "{");
    expect(() => loadConfig({ env })).toThrow("not valid JSON");

    writeFileSync(configPath(env), "[]");
    expect(() => loadConfig({ env })).toThrow("must be a JSON object");
  });
});

describe("saveConfig", () => {
  it("writes to ~/.ringko/config", () => {
    const path = saveConfig({ workspace: "." }, env);
    expect(path).toBe(configPath(env));
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ workspace: "." });
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
