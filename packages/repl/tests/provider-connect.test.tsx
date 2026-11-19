import { expect, it } from "bun:test";
import { PassThrough } from "node:stream";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackendClient } from "@ringko-ai/client";
import { findProviderPreset, getApiKey, loadConfig, PROVIDER_CONNECT_LIMITS, saveConfigFile, type ProviderConnectionInput } from "@ringko-ai/config";
import { ProviderConnectDialog } from "../src/components/ProviderConnectDialog.tsx";
import { Selector } from "../src/components/Selector.tsx";
import { Repl } from "../src/app.tsx";
import { startServer } from "../../app/src/server.ts";
import { render } from "./render.ts";

function terminal() {
  const input = new PassThrough(), output = new PassThrough();
  Object.assign(input, { isTTY: true, setRawMode: () => input, ref: () => input, unref: () => input }); Object.assign(output, { isTTY: true, columns: 100, rows: 36 });
  let text = ""; output.on("data", chunk => { text += chunk.toString(); });
  return { input, output, read: () => text, options: { stdin: input as unknown as NodeJS.ReadStream, stdout: output as unknown as NodeJS.WriteStream, stderr: output as unknown as NodeJS.WriteStream, exitOnCtrlC: false } };
}
async function wait(predicate: () => boolean) { const end = Date.now() + 5000; while (!predicate() && Date.now() < end) await Bun.sleep(20); expect(predicate()).toBe(true); }

it("connects from the key field with Enter and cancels pending saves without exposing credentials", async () => {
  const io = terminal(), gate = Promise.withResolvers<void>(); let captured: ProviderConnectionInput | undefined, signal: AbortSignal | undefined;
  const app = render(<ProviderConnectDialog preset={findProviderPreset("opencode-go")!} onClose={() => app.unmount()} onSave={async (input, current) => { captured = input; signal = current; await gate.promise; }} />, io.options);
  try {
    await wait(() => io.read().includes("Quick setup")); io.input.write("private-fixture-key"); await Bun.sleep(60); io.input.write("\r");
    await wait(() => captured !== undefined); expect(captured).toMatchObject({ name: "opencode-go", apiKey: "private-fixture-key", baseURL: "https://opencode.ai/inference/go/openai/v1" }); expect(captured?.modelIds).toBeUndefined(); expect(io.read()).not.toContain("private-fixture-key");
    io.input.write("\x1b"); await wait(() => signal?.aborted === true); gate.resolve();
  } finally { gate.resolve(); app.unmount(); io.input.destroy(); io.output.destroy(); }
});

it("rejects oversized keys instead of silently saving a truncated credential", async () => {
  const io = terminal(); let saved = false;
  const app = render(<ProviderConnectDialog preset={findProviderPreset("opencode-go")!} onClose={() => {}} onSave={async () => { saved = true; }} />, io.options);
  try {
    await wait(() => io.read().includes("Quick setup")); io.input.write("x".repeat(PROVIDER_CONNECT_LIMITS.key + 1));
    await wait(() => io.read().includes("exceeds its length limit")); expect(saved).toBe(false); expect(io.read()).not.toContain("x".repeat(20));
  } finally { app.unmount(); io.input.destroy(); io.output.destroy(); }
});

it("opens advanced defaults with Tab and edits name, endpoint and manual model IDs using Enter", async () => {
  const io = terminal(); let captured: ProviderConnectionInput | undefined;
  const app = render(<ProviderConnectDialog preset={findProviderPreset("opencode-go")!} onClose={() => {}} onSave={async input => { captured = input; }} />, io.options);
  const send = async (text: string) => { io.input.write(text); await Bun.sleep(60); };
  try {
    await wait(() => io.read().includes("Quick setup")); await send("private-fixture-key"); await send("\t"); await send("\x15"); await send("My Go"); await send("\r");
    await send("\x15"); await send("http://127.0.0.1:9999/v1"); await send("\r"); await send("\r"); await send("model-a,model-b"); await send("\r");
    await wait(() => captured !== undefined); expect(captured).toMatchObject({ name: "My Go", baseURL: "http://127.0.0.1:9999/v1", apiKey: "private-fixture-key", modelIds: ["model-a", "model-b"] }); expect(io.read()).not.toContain("private-fixture-key");
  } finally { app.unmount(); io.input.destroy(); io.output.destroy(); }
});

it("asks custom providers for a valid URL before continuing to the optional key", async () => {
  const io = terminal(); let captured: ProviderConnectionInput | undefined;
  const app = render(<ProviderConnectDialog preset={findProviderPreset("custom")!} onClose={() => {}} onSave={async input => { captured = input; }} />, io.options);
  try {
    await wait(() => io.read().includes("Quick setup")); io.input.write("\r"); await wait(() => io.read().includes("requires a base URL")); expect(captured).toBeUndefined();
    io.input.write("http://127.0.0.1:9999/v1"); await Bun.sleep(60); io.input.write("\r"); await Bun.sleep(60); io.input.write("\r");
    await wait(() => captured !== undefined); expect(captured).toMatchObject({ name: "custom", baseURL: "http://127.0.0.1:9999/v1" }); expect(captured?.apiKey).toBeUndefined();
  } finally { app.unmount(); io.input.destroy(); io.output.destroy(); }
});

it("uses the latest typed query when Enter arrives before a new frame", async () => {
  const io = terminal(), chosen: string[] = [];
  const app = render(<Selector title="Connect" rankedSearch items={[{ label: "OpenAI", value: "openai" }, { label: "OpenCode Go", value: "opencode-go", aliases: ["go"] }]} onSelect={value => chosen.push(value)} onCancel={() => {}} />, io.options);
  try {
    await wait(() => io.read().includes("OpenAI")); io.input.write("\x1b[200~go\x1b[201~\r"); await wait(() => chosen.length === 1); expect(chosen).toEqual(["opencode-go"]);
    io.input.write("\x15"); await Bun.sleep(5); io.input.write("\r"); await wait(() => chosen.length === 2); expect(chosen[1]).toBe("openai");
  } finally { app.unmount(); io.input.destroy(); io.output.destroy(); }
});

it("retries authoritative configuration reads without exposing their errors or using stale endpoints", async () => {
  const io = terminal(); let reads = 0, captured: ProviderConnectionInput | undefined;
  const app = render(<ProviderConnectDialog preset={findProviderPreset("opencode-go")!} initial={{ name: "Stale", baseURL: "https://stale.example/v1" }} loadInitial={async () => { if (++reads === 1) throw new Error("private-read-error"); return { name: "Fresh", baseURL: "http://127.0.0.1:9999/v1" }; }} onClose={() => {}} onSave={async input => { captured = input; }} />, io.options);
  try {
    await wait(() => io.read().includes("Cannot load provider settings")); expect(io.read()).not.toContain("private-read-error"); expect(io.read()).not.toContain("stale.example");
    io.input.write("r"); await wait(() => io.read().includes("Quick setup")); expect(reads).toBe(2); io.input.write("fresh-key"); await Bun.sleep(60); io.input.write("\r");
    await wait(() => captured !== undefined); expect(captured).toMatchObject({ name: "Fresh", baseURL: "http://127.0.0.1:9999/v1", apiKey: "fresh-key" }); expect(io.read()).not.toContain("fresh-key");
  } finally { app.unmount(); io.input.destroy(); io.output.destroy(); }
});

it("aborts configuration reads on dismissal and ignores their late completion", async () => {
  const io = terminal(), pending = Promise.withResolvers<{ name: string }>(); let signal: AbortSignal | undefined;
  const app = render(<ProviderConnectDialog preset={findProviderPreset("opencode-go")!} loadInitial={current => { signal = current; return pending.promise; }} onClose={() => app.unmount()} onSave={async () => { throw new Error("Unexpected save"); }} />, io.options);
  try {
    await wait(() => signal !== undefined); io.input.write("\x1b"); await wait(() => signal?.aborted === true); pending.resolve({ name: "Late provider" }); await Bun.sleep(60); expect(io.read()).not.toContain("Late provider");
  } finally { pending.resolve({ name: "settled" }); app.unmount(); io.input.destroy(); io.output.destroy(); }
});

it("opens configured API providers by typed name even when they use a transport alias", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-connect-existing-")), io = terminal();
  const config = { providers: [{ name: "Local", type: "compatible", baseURL: "http://127.0.0.1:9999/v1", models: [{ id: "fixture", name: "Fixture" }] }] };
  const backend = new BackendClient({ fetch: async url => String(url) === "/api/providers" ? Response.json(config) : Response.json({ tools: [], providers: [] }) });
  const app = render(<Repl workspace={root} config={config} modelLabel="Local" backend={backend} model={async () => ({ content: "unused", toolCalls: [] })} />, io.options);
  try {
    await Bun.sleep(180); io.input.write("/connect"); await Bun.sleep(60); io.input.write("\r"); await wait(() => io.read().includes("Connect a provider"));
    io.input.write("Local"); await Bun.sleep(60); io.input.write("\r"); await wait(() => io.read().includes("Quick setup"));
    expect(io.read()).toContain("Provider name: Local"); expect(io.read()).toContain("Connect Custom");
  } finally { app.unmount(); io.input.destroy(); io.output.destroy(); rmSync(root, { recursive: true, force: true }); }
});

it("configures OpenCode Go through /connect, discovers models and selects one without model calls", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-connect-tui-")), previous = process.env.RINGKO_HOME, previousAgents = process.env.AGENTS_HOME;
  process.env.RINGKO_HOME = join(root, "home"); process.env.AGENTS_HOME = join(root, "agents");
  const path = join(root, "explicit.json");
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    expect(new URL(request.url).pathname).toBe("/v1/models");
    return Response.json({ data: [{ id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" }, { id: "gemini-4-argon", name: "Gemini 4 Argon" }] });
  } });
  const config = { providers: [{ name: "opencode-go", type: "opencode-go", baseURL: `http://127.0.0.1:${upstream.port}/openai/v1`, models: [] }] }; saveConfigFile(config, path);
  const server = startServer({ workspace: root, shared: true, port: 0, configPath: path }), io = terminal(); let calls = 0;
  const app = render(<Repl config={config} configPath={path} workspace={root} backend={new BackendClient({ url: server.url, workspace: root })} modelLabel="Offline" model={async () => { calls++; return { content: "unused", toolCalls: [] }; }} />, io.options);
  try {
    await Bun.sleep(180); io.input.write("/connect"); await Bun.sleep(60); io.input.write("\r"); await wait(() => io.read().includes("Connect a provider"));
    io.input.write("opencodego"); await Bun.sleep(60); io.input.write("\r"); await wait(() => io.read().includes("Quick setup"));
    io.input.write("fixture-private-api-key"); await Bun.sleep(60); io.input.write("\r"); await wait(() => io.read().includes("opencode-go models")); await Bun.sleep(80);
    expect(getApiKey("opencode-go")).toBe("fixture-private-api-key"); expect(io.read()).not.toContain("fixture-private-api-key");
    io.input.write("gemini"); await Bun.sleep(60); io.input.write("\r"); await wait(() => loadConfig({ path }).model === "opencode-go/gemini-4-argon"); expect(calls).toBe(0);
  } finally {
    app.unmount(); io.input.destroy(); io.output.destroy(); await server.stop(); upstream.stop(true);
    if (previous === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previous;
    if (previousAgents === undefined) delete process.env.AGENTS_HOME; else process.env.AGENTS_HOME = previousAgents;
    rmSync(root, { recursive: true, force: true });
  }
}, 15_000);
