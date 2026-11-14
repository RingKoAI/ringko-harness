import { afterEach, beforeEach, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { providerPath, saveSettings, settingsPath } from "@ringko-ai/config";
import { BackendClient } from "@ringko-ai/client";
import { startServer, type RingkoServer } from "../src/server.ts";

let root: string, workspace: string, previous: string | undefined, previousAgents: string | undefined, server: RingkoServer | undefined;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ringko-instruction-config-")); workspace = join(root, "workspace");
  previous = process.env.RINGKO_HOME; previousAgents = process.env.AGENTS_HOME;
  process.env.RINGKO_HOME = join(root, "home"); process.env.AGENTS_HOME = join(root, "agents");
  mkdirSync(join(workspace, ".git"), { recursive: true }); writeFileSync(join(workspace, "AGENTS.md"), "Root policy");
});
afterEach(async () => {
  await server?.stop(); server = undefined;
  if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous;
  if (previousAgents === undefined) delete process.env.AGENTS_HOME; else process.env.AGENTS_HOME = previousAgents;
  rmSync(root, { recursive: true, force: true });
});

async function finish(client: BackendClient, id: string) {
  const deadline = Date.now() + 5000;
  let snapshot = await client.snapshot(id);
  while (snapshot.busy && Date.now() < deadline) { await Bun.sleep(10); snapshot = await client.snapshot(id); }
  expect(snapshot.busy).toBe(false);
  return snapshot;
}

it("initializes both user files through a direct backend startup and completes the first chat", async () => {
  server = startServer({ workspace, shared: true, port: 0 });
  expect(JSON.parse(readFileSync(settingsPath(), "utf8")).instructionScan).toMatchObject({ recursive: true, excludeNestedRepositories: true, maxDepth: 12, maxDirectories: 4096 });
  expect(JSON.parse(readFileSync(providerPath(), "utf8"))).toEqual({ model: "", small_model: "", providers: [] });
  const client = new BackendClient({ url: server.url, workspace });
  const run = await client.run({ prompt: "First startup" });
  const snapshot = await finish(client, run.sessionId);
  expect(snapshot.error).toBeNull(); expect(snapshot.messages.at(-1)?.content).toBe("echo: First startup");
});

it("applies saved scan policy to real agent runs and reads repaired exclusions on the next run", async () => {
  mkdirSync(join(workspace, "pkg")); writeFileSync(join(workspace, "pkg", "AGENTS.md"), "Package policy");
  for (const prefix of ["bulk", "Example/repo"]) {
    mkdirSync(join(workspace, prefix), { recursive: true });
    for (let index = 0; index < 6; index++) mkdirSync(join(workspace, prefix, String(index)));
  }
  mkdirSync(join(workspace, "Example/repo/.git"));
  saveSettings({ instructionScan: { maxDirectories: 3, excludeDirectories: ["bulk"] } });
  server = startServer({ workspace, shared: true, port: 0 });
  const client = new BackendClient({ url: server.url, workspace });
  const first = await client.run({ prompt: "Exclude bulky sources and independent repositories" });
  expect((await finish(client, first.sessionId)).error).toBeNull();
  saveSettings({ instructionScan: { maxDirectories: 1 } });
  await client.run({ sessionId: first.sessionId, prompt: "The small real budget must fail" });
  expect((await finish(client, first.sessionId)).error).toContain("directory limit (1)");
  saveSettings({ instructionScan: { maxDirectories: 2, excludeDirectories: ["bulk", "Example"] } });
  await client.run({ sessionId: first.sessionId, prompt: "Retry with repaired exclusions" });
  const recovered = await finish(client, first.sessionId);
  expect(recovered.error).toBeNull(); expect(recovered.messages.at(-1)?.content).toBe("echo: Retry with repaired exclusions");
});

it("honors an explicit backend config without creating either user configuration file", async () => {
  const path = join(root, "explicit.json"); writeFileSync(path, '{"providers":[],"instructionScan":{"recursive":false}}');
  server = startServer({ workspace, configPath: path, shared: true, port: 0 });
  const client = new BackendClient({ url: server.url, workspace });
  const run = await client.run({ prompt: "Explicit settings" });
  expect((await finish(client, run.sessionId)).error).toBeNull();
  expect(existsSync(settingsPath())).toBe(false); expect(existsSync(providerPath())).toBe(false);
  expect(readFileSync(path, "utf8")).toBe('{"providers":[],"instructionScan":{"recursive":false}}');
});
