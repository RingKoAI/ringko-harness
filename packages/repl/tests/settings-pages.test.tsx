import { expect, it } from "bun:test";
import { PassThrough } from "node:stream";
import { StatusDialog } from "../src/components/StatusDialog.tsx";
import { statusSettings, type StatusConfigInfo, type StatusTab } from "../src/status.ts";
import { render } from "./render.ts";
import { Repl } from "../src/app.tsx";
import { BackendClient } from "@ringko-ai/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig, saveConfigFile } from "@ringko-ai/config";
import { SessionStore, recordUserMessage, recordAssistantMessage, recordSessionUsage } from "@ringko-ai/session";
import { startServer } from "../../app/src/server.ts";
import { statisticsFixture } from "./stats-fixture.ts";

function terminal() {
  const input = new PassThrough(), output = new PassThrough();
  Object.assign(input, { isTTY: true, setRawMode: () => input, ref: () => input, unref: () => input }); Object.assign(output, { isTTY: true, columns: 110, rows: 40 });
  let text = ""; output.on("data", chunk => { text += chunk.toString(); });
  return { input, output, read: () => text, clear: () => { text = ""; }, options: { stdin: input as unknown as NodeJS.ReadStream, stdout: output as unknown as NodeJS.WriteStream, stderr: output as unknown as NodeJS.WriteStream, exitOnCtrlC: false } };
}
async function wait(predicate: () => boolean): Promise<void> { const end = Date.now() + 5000; while (!predicate() && Date.now() < end) await Bun.sleep(20); expect(predicate()).toBe(true); }
const initial = (): StatusConfigInfo => ({ expandThinking: false, expandTools: false, thinking: "high", accessMode: "approval", updates: { checkOnStartup: true, autoUpdate: false } });

it("requires explicit Y before the settings page can enable full sandbox access", async () => {
  const io = terminal(), info = { ...initial(), permissionPreset: "default" as const }; let changes = 0;
  const app = render(<StatusDialog initialTab="Config" load={async () => ({ version: null, entries: [], settings: statusSettings(info) })} session={{}} columns={109} height={38} onClose={() => {}} onMcp={() => {}} onConfigChange={async (key, value) => { expect(key).toBe("permissionPreset"); expect(value).toBe("full-access"); changes++; }} />, io.options);
  try {
    await wait(() => io.read().includes("Permissions: default")); io.input.write("\x1b[B\x1b[B\x1b[B\x1b[B\x1b[B"); await Bun.sleep(60); io.input.write("\r");
    await wait(() => io.read().includes("Y confirm / Esc cancel")); expect(changes).toBe(0);
    io.input.write("\r"); await Bun.sleep(60); expect(changes).toBe(0);
    io.input.write("\x1b"); await Bun.sleep(60); expect(changes).toBe(0);
    io.input.write("\r"); await Bun.sleep(60); io.input.write("y"); await wait(() => changes === 1);
  } finally { app.unmount(); io.input.destroy(); io.output.destroy(); }
});

it("switches the four pages, filters settings, saves an explicit value and changes the statistics range", async () => {
  const io = terminal(), info = initial(), loaded: Array<[StatusTab, string]> = []; let changed = 0, closed = 0;
  const app = render(<StatusDialog load={async (_signal, tab, period) => { loaded.push([tab, period]); return { version: null, entries: [{ label: "Page", value: tab }], ...(tab === "Config" ? { settings: statusSettings(info) } : {}) }; }} session={{}} columns={109} height={38} onClose={() => { closed++; }} onMcp={() => {}} onConfigChange={async (key, value) => { if (key === "expandTools" && typeof value === "boolean") { info.expandTools = value; changed++; } }} />, io.options);
  try {
    await wait(() => io.read().includes("Version:")); io.input.write("\t"); await wait(() => io.read().includes("Show reasoning"));
    io.input.write("/"); await wait(() => io.read().includes("Search:")); io.input.write("tools"); await wait(() => io.read().includes("Search: tools")); io.input.write("\r"); await Bun.sleep(60); io.input.write("\r");
    await wait(() => changed === 1); await wait(() => io.read().includes("Expand tool details: On"));
    io.input.write("\t"); await wait(() => loaded.some(([tab]) => tab === "Usage"));
    io.input.write("\t"); await wait(() => loaded.some(([tab]) => tab === "Stats")); io.input.write("t"); await wait(() => loaded.some(([tab, period]) => tab === "Stats" && period === "7d"));
    io.input.write("\x1b"); await wait(() => closed === 1);
  } finally { app.unmount(); io.input.destroy(); io.output.destroy(); }
}, 15_000);

it("switches Overview and Models independently of the main pages and date range", async () => {
  const io = terminal(), periods: string[] = [];
  const app = render(<StatusDialog initialTab="Stats" load={async (_signal, _tab, period) => { periods.push(period); return { version: null, entries: [], statistics: statisticsFixture() }; }} session={{}} columns={109} height={38} onClose={() => {}} onMcp={() => {}} />, io.options);
  try {
    await wait(() => io.read().includes("Favorite model:")); io.clear(); io.input.write("\x1b[C"); await wait(() => io.read().includes("Model usage"));
    expect(periods).toEqual(["all"]); io.input.write("t"); await wait(() => periods.includes("7d")); await Bun.sleep(80);
    io.clear(); io.input.write("o"); await wait(() => io.read().includes("Favorite model:")); expect(io.read()).toContain("Current streak:");
  } finally { app.unmount(); io.input.destroy(); io.output.destroy(); }
});

it("does not report failed configuration saves as success or expose their private error", async () => {
  const io = terminal();
  const app = render(<StatusDialog initialTab="Config" load={async () => ({ version: null, entries: [], settings: statusSettings(initial()) })} session={{}} columns={109} height={38} onClose={() => {}} onMcp={() => {}} onConfigChange={async () => { throw new Error("private-save-detail"); }} />, io.options);
  try {
    await wait(() => io.read().includes("Show reasoning: Off")); io.clear(); io.input.write(" ");
    await wait(() => io.read().includes("Could not save setting")); expect(io.read()).not.toContain("private-save-detail"); expect(io.read()).not.toContain("Saved.");
  } finally { app.unmount(); io.input.destroy(); io.output.destroy(); }
});

it("aborts a pending save on dismissal and never publishes its late success", async () => {
  const io = terminal(), pending = Promise.withResolvers<void>(); let signal: AbortSignal | undefined;
  const app = render(<StatusDialog initialTab="Config" load={async () => ({ version: null, entries: [], settings: statusSettings(initial()) })} session={{}} columns={109} height={38} onClose={() => app.unmount()} onMcp={() => {}} onConfigChange={async (_key, _value, current) => { signal = current; await pending.promise; }} />, io.options);
  try {
    await wait(() => io.read().includes("Show reasoning: Off")); await Bun.sleep(60); io.input.write(" "); await wait(() => signal !== undefined);
    io.input.write("\x1b"); await wait(() => signal?.aborted === true); io.clear(); pending.resolve(); await Bun.sleep(80);
    expect(io.read()).not.toContain("Saved.");
  } finally { pending.resolve(); app.unmount(); io.input.destroy(); io.output.destroy(); }
});

it("does not persist a local thinking change after its model build was cancelled", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-settings-cancel-")), previousHome = process.env.RINGKO_HOME, previousAgents = process.env.AGENTS_HOME;
  process.env.RINGKO_HOME = join(root, "home"); process.env.AGENTS_HOME = join(root, "agents");
  const config = { thinking: "high", providers: [{ name: "Fixture", type: "echo", models: [{ id: "model", name: "Model" }] }] };
  saveConfig(config); const io = terminal(), pending = Promise.withResolvers<() => Promise<{ content: string; toolCalls: [] }>>(); let builds = 0;
  const app = render(<Repl workspace={root} config={config} modelLabel="Fixture" model={async () => ({ content: "", toolCalls: [] })} createModel={async () => { builds++; return pending.promise; }} />, io.options);
  try {
    await Bun.sleep(180); io.input.write("/config"); await Bun.sleep(60); io.input.write("\r"); await wait(() => io.read().includes("Thinking effort: high")); await Bun.sleep(60);
    io.input.write("\x1b[B\x1b[B\x1b[B\x1b[B"); await Bun.sleep(60); io.input.write("\r"); await wait(() => builds === 1);
    io.clear(); io.input.write("\x1b"); await wait(() => io.read().includes("Message, /command")); pending.resolve(async () => ({ content: "unused", toolCalls: [] })); await Bun.sleep(100);
    expect(loadConfig().thinking).toBe("high");
  } finally {
    pending.resolve(async () => ({ content: "unused", toolCalls: [] })); app.unmount(); io.input.destroy(); io.output.destroy();
    if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
    if (previousAgents === undefined) delete process.env.AGENTS_HOME; else process.env.AGENTS_HOME = previousAgents;
    rmSync(root, { recursive: true, force: true });
  }
}, 15_000);

it("does not edit a previous page's configuration during batched tab navigation", async () => {
  const io = terminal(), pending = Promise.withResolvers<{ version: null; entries: []; settings: ReturnType<typeof statusSettings> }>(); let changed = 0;
  const app = render(<StatusDialog initialTab="Config" load={async (_signal, tab) => tab === "Config" ? pending.promise : { version: null, entries: [] }} session={{}} columns={109} height={38} onClose={() => {}} onMcp={() => {}} onConfigChange={async () => { changed++; }} />, io.options);
  try {
    pending.resolve({ version: null, entries: [], settings: statusSettings(initial()) });
    await wait(() => io.read().includes("Show reasoning: Off")); await Bun.sleep(60);
    // Config -> Usage -> Config and Enter arrive before a new frame/load finishes.
    io.input.write("\t\x1b[Z\r"); await Bun.sleep(100);
    expect(changed).toBe(0);
    await wait(() => io.read().includes("Show reasoning: Off")); await Bun.sleep(60); io.input.write("\r"); await wait(() => changed === 1);
  } finally { app.unmount(); io.input.destroy(); io.output.destroy(); }
});

it("uses real backend configuration and usage pages without model calls or new sessions", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-settings-pages-")), previousHome = process.env.RINGKO_HOME, previousAgents = process.env.AGENTS_HOME;
  process.env.RINGKO_HOME = join(root, "home"); process.env.AGENTS_HOME = join(root, "agents");
  const path = join(root, "explicit.json"), config = { model: "Fixture/model", providers: [{ name: "Fixture", type: "echo", models: [{ id: "model", name: "Model" }] }] };
  saveConfig({ ...config, expandThinking: false }); saveConfigFile({ ...config, expandThinking: false }, path);
  const session = new SessionStore({ cwd: root }).create(); recordUserMessage(session, "fixture"); recordAssistantMessage(session, 1, "answer", []); recordSessionUsage(session, { inputTokens: 100, outputTokens: 40, cacheReadTokens: 60 }, "Fixture/model", { durationMs: 1000, kind: "primary" }); const id = session.id; session.close();
  const server = startServer({ workspace: root, port: 0, shared: true, configPath: path }); const io = terminal(); let calls = 0;
  const app = render(<Repl backend={new BackendClient({ url: server.url, workspace: root })} resumeSessionId={id} workspace={root} config={config} modelLabel="Fixture" model={async () => { calls++; throw new Error("UI must not call a model"); }} />, io.options);
  try {
    await Bun.sleep(180); io.input.write("/config"); await Bun.sleep(60); io.input.write("\r"); await wait(() => io.read().includes("Show reasoning: Off")); await Bun.sleep(60); io.input.write("\r");
    await wait(() => loadConfig({ path }).expandThinking === true); expect(loadConfig().expandThinking).toBe(false);
    await wait(() => io.read().includes("Saved.")); await Bun.sleep(60);
    io.clear(); io.input.write("\t"); await wait(() => io.read().includes("Total tokens:")); expect(io.read()).toContain("140");
    io.clear(); io.input.write("\t"); await wait(() => io.read().includes("Recorded requests:")); expect(io.read()).toContain("Requests with timing:");
    expect(new SessionStore({ cwd: root }).list()).toHaveLength(1); expect(calls).toBe(0);
  } finally {
    app.unmount(); io.input.destroy(); io.output.destroy(); await server.stop();
    if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
    if (previousAgents === undefined) delete process.env.AGENTS_HOME; else process.env.AGENTS_HOME = previousAgents;
    rmSync(root, { recursive: true, force: true });
  }
}, 15_000);
