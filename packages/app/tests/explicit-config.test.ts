import { expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, loadProviders, saveConfig, saveConfigFile } from "@ringko-ai/config";
import { BackendClient } from "@ringko-ai/client";
import { startServer } from "../src/server.ts";

it("model, thinking and display controls update the explicit config without touching global settings", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-explicit-config-"));
  const previous = process.env.RINGKO_HOME; process.env.RINGKO_HOME = join(root, "home");
  const path = join(root, "fixture.json");
  saveConfig({ model: "Global/original", thinking: "high", expandTools: false, providers: [] });
  saveConfigFile({ model: "Fixture/one", providers: [{ name: "Fixture", type: "echo", models: [{ id: "one", name: "One" }, { id: "two", name: "Two" }] }] }, path);
  const app = startServer({ workspace: root, configPath: path, port: 0, shared: true });
  const client = new BackendClient({ url: app.url, workspace: root });
  try {
    const info = await client.request<{ modelId: string }>("/api/model", { model: "Fixture/two" });
    expect(info.modelId).toBe("Fixture/two");
    await client.request("/api/thinking", { level: "low" });
    await client.request("/api/ui", { expandTools: true });
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ model: "Fixture/two", thinking: "low", expandTools: true });
    expect(loadProviders().model).toBe("Global/original");
    expect(loadConfig()).toMatchObject({ thinking: "high", expandTools: false });
  } finally {
    app.stop();
    if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
