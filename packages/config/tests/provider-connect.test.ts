import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { authPath, getApiKey, loadConfig, parseProviderConnection, saveProviderConnection, setApiKey, findProviderPreset, knownModels, openCodeGoModelsUrl, resolveProviderApiKey } from "../src/index.ts";

it("exposes OpenCode Go through presets and the offline model catalog", () => {
  expect(findProviderPreset("opencode-go")).toMatchObject({ label: "OpenCode Go", type: "opencode-go", apiKeyEnv: "OPENCODE_API_KEY" });
  expect(knownModels("opencode-go").some(model => model.id === "gemini-4-argon")).toBe(true);
  expect(openCodeGoModelsUrl()).toBe("https://opencode.ai/inference/go/v1/models");
  expect(openCodeGoModelsUrl("http://127.0.0.1/openai/v1/")).toBe("http://127.0.0.1/v1/models");
});

it("rejects reserved names, unsafe URLs, key injection and excessive model lists", () => {
  const valid = { name: "opencode-go", type: "opencode-go", apiKey: "fixture" };
  for (const patch of [{ name: "__proto__" }, { name: "a/b" }, { baseURL: "https://user:private@example.com/v1" }, { baseURL: "https://example.com/v1?key=private" }, { baseURL: "file:///tmp/models" }, { apiKey: "secret\r\nx-injected: yes" }, { modelIds: ["\u0000"] }, { modelIds: Array(501).fill("model") }, { type: "anthropic-oauth" }]) expect(() => parseProviderConnection({ ...valid, ...patch })).toThrow();
  expect(parseProviderConnection({ ...valid, modelIds: ["a", "a", "b"] }).modelIds).toEqual(["a", "b"]);
});

it("saves keys outside explicit configs and retains existing model metadata", () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-provider-connect-")), env = { ...process.env, RINGKO_HOME: join(root, "home") }, path = join(root, "explicit.json");
  try {
    const result = saveProviderConnection({ permission: "approval", providers: [{ name: "opencode-go", type: "opencode-go", models: [{ id: "old", name: "Custom", maxOutputTokens: 99 }] }] }, { name: "opencode-go", type: "opencode-go", apiKey: "new-private-key" }, [{ id: "old" }, { id: "new", name: "New model" }], { path, env });
    expect(getApiKey("opencode-go", env)).toBe("new-private-key"); expect(readFileSync(path, "utf8")).not.toContain("new-private-key"); expect(JSON.stringify(result.provider)).not.toContain("new-private-key");
    expect(loadConfig({ path }).providers?.[0]?.models?.[0]).toMatchObject({ name: "Custom", maxOutputTokens: 99 });
    expect(loadConfig({ path }).permission).toBe("approval"); expect(result.config.model).toBe("opencode-go/old");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("restores the previous key when configuration persistence fails and refuses corrupt auth stores", () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-provider-connect-fail-")), env = { ...process.env, RINGKO_HOME: join(root, "home") };
  const input = { name: "opencode-go", type: "opencode-go", apiKey: "replacement" }, models = [{ id: "model" }];
  try {
    setApiKey(input.name, "previous", env);
    expect(() => saveProviderConnection({}, input, models, { path: root, env })).toThrow("Cannot save provider configuration");
    expect(getApiKey(input.name, env)).toBe("previous");
    mkdirSync(dirname(authPath(env)), { recursive: true }); writeFileSync(authPath(env), "broken-json");
    expect(() => saveProviderConnection({}, input, models, { path: join(root, "config.json"), env })).toThrow("Repair auth.json");
    expect(readFileSync(authPath(env), "utf8")).toBe("broken-json");
    writeFileSync(authPath(env), JSON.stringify({ apikeys: { legacy: 17 }, oauth: {} }));
    expect(() => saveProviderConnection({}, input, models, { path: join(root, "config.json"), env })).toThrow("Repair auth.json");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("uses preset environment credentials without persisting or replacing them", () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-provider-env-")), env = { RINGKO_HOME: root, OPENCODE_API_KEY: "environment-fixture" };
  try {
    expect(resolveProviderApiKey({ name: "My Go", type: "opencode-go" }, env)).toBe("environment-fixture"); expect(resolveProviderApiKey({ name: "My Go", type: "opencode-go", apiKey: "explicit" }, env)).toBe("explicit"); expect(getApiKey("My Go", env)).toBeUndefined();
    setApiKey("My Go", "stored-fixture", env); expect(resolveProviderApiKey({ name: "My Go", type: "opencode-go", apiKey: "" }, env)).toBe("stored-fixture");
    expect(resolveProviderApiKey({ name: "azure-openai", type: "openai-compatible", baseURL: "https://resource.openai.azure.com/openai/v1" }, { ...env, AZURE_OPENAI_API_KEY: "azure-fixture" })).toBe("azure-fixture");
  }
  finally { rmSync(root, { recursive: true, force: true }); }
});

it("rejects a Go connection without credentials before changing configuration", () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-provider-missing-key-"));
  try { expect(() => saveProviderConnection({}, { name: "opencode-go", type: "opencode-go" }, [{ id: "model" }], { env: { RINGKO_HOME: root } })).toThrow("Enter a valid OpenCode Go API key"); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
