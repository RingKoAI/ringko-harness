import { afterEach, beforeEach, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig, saveConfigFile } from "../src/config.ts";
import { defaultProviderFile, defaultSettings } from "../src/defaults.ts";
import { initializeConfig } from "../src/initialize.ts";
import { createJsonIfMissing, replaceJson } from "../src/json-file.ts";
import { providerPath, ringkoRoot, settingsPath } from "../src/paths.ts";

let home: string, env: NodeJS.ProcessEnv;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "ringko-initialize-")); env = { RINGKO_HOME: home }; });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

it("creates complete default files once without binding the launch workspace or inventing credentials", () => {
  expect(loadConfig({ env })).toEqual({});
  expect(existsSync(ringkoRoot(env))).toBe(false);
  expect(initializeConfig({ env })).toEqual([settingsPath(env), providerPath(env)]);
  expect(JSON.parse(readFileSync(settingsPath(env), "utf8"))).toEqual(defaultSettings());
  expect(JSON.parse(readFileSync(providerPath(env), "utf8"))).toEqual({ model: "", small_model: "", providers: [] });
  expect(loadConfig({ env }).workspace).toBeUndefined();
  expect(initializeConfig({ env })).toEqual([]);
  expect(readdirSync(ringkoRoot(env)).sort()).toEqual(["provider.json", "settings.local.json"]);
  if (process.platform !== "win32") {
    expect(statSync(ringkoRoot(env)).mode & 0o777).toBe(0o700);
    expect(statSync(settingsPath(env)).mode & 0o777).toBe(0o600);
    expect(statSync(providerPath(env)).mode & 0o777).toBe(0o600);
  }
});

it("only creates the missing half and preserves existing settings and provider bytes", () => {
  mkdirSync(ringkoRoot(env));
  const settings = '{ "permission": "assist", "custom": true }\n';
  writeFileSync(settingsPath(env), settings);
  expect(initializeConfig({ env })).toEqual([providerPath(env)]);
  expect(readFileSync(settingsPath(env), "utf8")).toBe(settings);
  rmSync(settingsPath(env));
  const providers = '{ "model": "custom/model", "providers": [{ "name": "custom", "apiKey": "fixture-secret" }] }\n';
  writeFileSync(providerPath(env), providers);
  expect(initializeConfig({ env })).toEqual([settingsPath(env)]);
  expect(readFileSync(providerPath(env), "utf8")).toBe(providers);
});

it("preserves empty placeholders, rejects malformed existing JSON without exposing its content", () => {
  mkdirSync(ringkoRoot(env));
  writeFileSync(settingsPath(env), "");
  expect(initializeConfig({ env })).toEqual([providerPath(env)]);
  expect(readFileSync(settingsPath(env), "utf8")).toBe("");
  rmSync(providerPath(env));
  const broken = '{ "apiKey": "fixture-do-not-log",';
  writeFileSync(settingsPath(env), broken);
  expect(() => initializeConfig({ env })).toThrow("not valid JSON");
  try { initializeConfig({ env }); } catch (error) { expect(String(error)).not.toContain("fixture-do-not-log"); }
  expect(readFileSync(settingsPath(env), "utf8")).toBe(broken);
  expect(existsSync(providerPath(env))).toBe(false);
  writeFileSync(settingsPath(env), "[]");
  expect(() => initializeConfig({ env })).toThrow("must be a JSON object");
});

it("leaves user configuration untouched when an explicit path is supplied", () => {
  expect(initializeConfig({ env, path: join(home, "explicit.json") })).toEqual([]);
  for (const path of ["", " ", "bad\0path"]) expect(() => initializeConfig({ env, path })).toThrow("non-empty filesystem path");
  expect(readdirSync(home)).toEqual([]);
});

it("rejects a directory target before generating its sibling", () => {
  mkdirSync(providerPath(env), { recursive: true });
  expect(() => initializeConfig({ env })).toThrow("regular file");
  expect(existsSync(settingsPath(env))).toBe(false);
});

it("keeps a concurrent winner and removes staged data when exclusive publication loses", () => {
  const path = settingsPath(env);
  expect(createJsonIfMissing(path, { toJSON() { writeFileSync(path, '{"winner":true}'); return { loser: true }; } })).toBe(false);
  expect(readFileSync(path, "utf8")).toBe('{"winner":true}');
  expect(readdirSync(ringkoRoot(env))).toEqual(["settings.local.json"]);
});

it("cleans staging files on serialization and publication failures", () => {
  expect(() => createJsonIfMissing(settingsPath(env), { value: BigInt(1) })).toThrow();
  expect(readdirSync(ringkoRoot(env))).toEqual([]);
  expect(() => createJsonIfMissing(settingsPath(env), { toJSON() { mkdirSync(settingsPath(env)); return {}; } })).toThrow("regular file");
  expect(readdirSync(ringkoRoot(env))).toEqual(["settings.local.json"]);
  const path = join(ringkoRoot(env), "atomic.json");
  expect(() => replaceJson(path, { toJSON() { mkdirSync(path); writeFileSync(join(path, "winner.txt"), "keep"); return {}; } })).toThrow();
  expect(readFileSync(join(path, "winner.txt"), "utf8")).toBe("keep");
  expect(readdirSync(ringkoRoot(env)).sort()).toEqual(["atomic.json", "settings.local.json"]);
});

it("allows concurrent startup processes to publish each default file exactly once", async () => {
  const source = pathToFileURL(join(import.meta.dir, "../src/initialize.ts")).href;
  const children = Array.from({ length: 6 }, () => Bun.spawn([process.execPath, "--eval", `import { initializeConfig } from ${JSON.stringify(source)}; console.log(JSON.stringify(initializeConfig()));`], {
    env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe",
  }));
  const results = await Promise.all(children.map(async child => {
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(err).toBe(""); expect(code).toBe(0); return JSON.parse(out) as string[];
  }));
  expect(results.flat().sort()).toEqual([providerPath(env), settingsPath(env)].sort());
  expect(loadConfig({ env }).instructionScan?.maxDirectories).toBe(4096);
  expect(readdirSync(ringkoRoot(env)).sort()).toEqual(["provider.json", "settings.local.json"]);
}, 15_000);

it.skipIf(process.platform === "win32")("preserves managed symlinks and refuses to regenerate broken ones", () => {
  mkdirSync(ringkoRoot(env));
  const managed = join(home, "managed.json"); writeFileSync(managed, '{"thinking":"low"}');
  symlinkSync(managed, settingsPath(env));
  initializeConfig({ env });
  expect(loadConfig({ env }).thinking).toBe("low");
  saveConfigFile({ thinking: "high" }, settingsPath(env));
  expect(JSON.parse(readFileSync(managed, "utf8"))).toEqual({ thinking: "high" });
  rmSync(managed);
  expect(() => initializeConfig({ env })).toThrow("broken symbolic link");
  expect(() => saveConfigFile({}, settingsPath(env))).toThrow("broken symbolic link");
});

it("returns independent default objects", () => {
  const settings = defaultSettings(), providers = defaultProviderFile();
  settings.instructionScan!.excludeDirectories = []; providers.providers!.push({ name: "mutated" });
  expect(defaultSettings().instructionScan!.excludeDirectories!.length).toBeGreaterThan(0);
  expect(defaultProviderFile().providers).toEqual([]);
});
