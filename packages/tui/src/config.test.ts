import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configDir,
  defaultConfigPath,
  getConfigValue,
  loadConfig,
  parseConfigValue,
  saveConfig,
  setConfigValue,
  unsetConfigValue,
} from "./config.ts";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ringko-home-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("config paths", () => {
  it("stores under ~/.ringko/config", () => {
    expect(configDir("/home/user")).toBe(join("/home/user", ".ringko"));
    expect(defaultConfigPath("/home/user")).toBe(join("/home/user", ".ringko", "config"));
  });
});

describe("loadConfig", () => {
  it("returns an empty config when the default file is missing", () => {
    expect(loadConfig({ home })).toEqual({});
  });

  it("throws when an explicit file is missing", () => {
    expect(() => loadConfig({ path: "missing.json", cwd: home })).toThrow("Cannot read config");
  });

  it("parses the default config file", () => {
    saveConfig({ provider: { name: "openai", model: "gpt-4o-mini" } }, home);
    const config = loadConfig({ home });
    expect(config.provider?.name).toBe("openai");
  });

  it("rejects invalid JSON and non-object roots", () => {
    mkdirSync(configDir(home), { recursive: true });
    writeFileSync(defaultConfigPath(home), "{");
    expect(() => loadConfig({ home })).toThrow("not valid JSON");

    writeFileSync(defaultConfigPath(home), "[]");
    expect(() => loadConfig({ home })).toThrow("must be a JSON object");
  });
});

describe("saveConfig", () => {
  it("creates the directory and writes JSON", () => {
    const path = saveConfig({ workspace: "." }, home);
    expect(path).toBe(defaultConfigPath(home));
    expect(existsSync(configDir(home))).toBe(true);
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
