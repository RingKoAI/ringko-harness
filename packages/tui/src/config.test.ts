import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfigPath, loadConfig } from "./config.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ringko-config-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns an empty config when the default file is missing", () => {
    expect(loadConfig(undefined, dir)).toEqual({});
  });

  it("throws when an explicit file is missing", () => {
    expect(() => loadConfig("missing.json", dir)).toThrow("Cannot read config");
  });

  it("parses a provider config", () => {
    writeFileSync(
      defaultConfigPath(dir),
      JSON.stringify({ provider: { name: "openai", model: "gpt-4o-mini" }, capabilities: { shell: true } }),
    );

    const config = loadConfig(undefined, dir);

    expect(config.provider?.name).toBe("openai");
    expect(config.capabilities?.shell).toBe(true);
  });

  it("rejects invalid JSON and non-object roots", () => {
    writeFileSync(defaultConfigPath(dir), "{");
    expect(() => loadConfig(undefined, dir)).toThrow("not valid JSON");

    writeFileSync(defaultConfigPath(dir), "[]");
    expect(() => loadConfig(undefined, dir)).toThrow("must be a JSON object");
  });
});
