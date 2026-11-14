import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VERSION, runCli, type CliIo } from "../src/cli.ts";
import { ModelCatalogCache, saveConfig } from "@ringko-ai/config";
import { recordAssistantMessage, recordUserMessage, SessionStore } from "@ringko-ai/session";

function collect(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (line) => out.push(line), err: (line) => err.push(line) }, out, err };
}

let home: string;
let previousHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ringko-cli-home-"));
  previousHome = process.env.RINGKO_HOME;
  process.env.RINGKO_HOME = home;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.RINGKO_HOME;
  else process.env.RINGKO_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

describe("ringko cli", () => {
  it("handles command help before execution, initialization, or config mutations", async () => {
    for (const args of [["run", "--help"], ["web", "-h"], ["config", "set", "permission", "full", "--help"], ["auth", "login", "--help"]]) {
      const result = collect(); expect(await runCli(args, result.io)).toBe(0); expect(result.out.join("\n")).toContain("Usage:");
    }
    expect(existsSync(join(home, ".ringko", "settings.local.json"))).toBe(false);
  });

  it("preserves run prompt options after the literal separator", async () => {
    const result = collect(); expect(await runCli(["run", "--workspace", home, "--", "--help", "--model", "literal"], result.io)).toBe(0);
    expect(result.out).toEqual(["echo: --help --model literal"]);
  });

  it("reports the configured access mode and rejects invalid modes", async () => {
    saveConfig({ permission: "assist" }); const result = collect();
    expect(await runCli(["info"], result.io)).toBe(0); expect(result.out[0]).toContain("assist");
    saveConfig({ permission: "invalid" }); expect(await runCli(["info"], collect().io)).toBe(2);
  });

  it("filters explicit workspace session lists and rejects unsupported session actions", async () => {
    const other = join(home, "other"); mkdirSync(other);
    const first = new SessionStore({ cwd: home }).create(), second = new SessionStore({ cwd: other }).create();
    recordUserMessage(first, "first"); recordUserMessage(second, "second"); first.close(); second.close();
    const result = collect(); expect(await runCli(["session", "list", "--workspace", home], result.io)).toBe(0);
    expect(result.out.join("\n")).toContain(first.id); expect(result.out.join("\n")).not.toContain(second.id);
    expect(await runCli(["session", "delete", first.id], collect().io)).toBe(2);
    expect(new SessionStore({ cwd: home }).list()).toHaveLength(1);
  });

  it("rejects loop counts beyond the safe integer range before executing", async () => {
    const result = collect(); expect(await runCli(["loop", "fixture", "--max-iterations", "9007199254740992"], result.io)).toBe(2);
    expect(result.err.join("\n")).toContain("safe non-negative integer"); expect(result.out).toEqual([]);
  });

  it("discovers and saves models only in the explicit config", async () => {
    const provider = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ data: [{ id: "discovered", name: "Discovered" }] }) });
    const path = join(home, "models.json");
    writeFileSync(path, JSON.stringify({ custom: true, providers: [{ name: "fixture", type: "openai-compatible", baseURL: `http://127.0.0.1:${provider.port}/v1`, models: [] }] }));
    try {
      const result = collect(); expect(await runCli(["models", "--config", path], result.io)).toBe(0);
      const saved = JSON.parse(readFileSync(path, "utf8")); expect(saved.custom).toBe(true); expect(saved.providers[0].models[0].id).toBe("discovered");
      expect(existsSync(join(home, ".ringko", "provider.json"))).toBe(false);
      expect(existsSync(join(home, ".ringko", "settings.local.json"))).toBe(false);
    } finally { provider.stop(true); }
  });
  it("creates default user files on first operational launch but not for help, version or unknown commands", async () => {
    const settings = join(home, ".ringko", "settings.local.json"), provider = join(home, ".ringko", "provider.json");
    for (const command of ["help", "--help", "version", "--version", "unknown"]) await runCli([command], collect().io);
    expect(existsSync(settings)).toBe(false); expect(existsSync(provider)).toBe(false);
    expect(await runCli(["info"], collect().io)).toBe(0);
    expect(JSON.parse(readFileSync(settings, "utf8")).instructionScan.excludeNestedRepositories).toBe(true);
    expect(JSON.parse(readFileSync(provider, "utf8"))).toEqual({ model: "", small_model: "", providers: [] });
  });

  it("keeps explicit configuration reads and writes isolated from user defaults", async () => {
    const path = join(home, "explicit.json"); writeFileSync(path, '{"permission":"assist","custom":true}');
    expect(await runCli(["config", "set", "instructionScan.maxDepth", "0", "--config", path], collect().io)).toBe(0);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ permission: "assist", custom: true, instructionScan: { maxDepth: 0 } });
    const result = collect(); expect(await runCli(["config", "path", "--config", path], result.io)).toBe(0); expect(result.out).toEqual([path]);
    expect(await runCli(["config", "unset", "custom", "--config", path], collect().io)).toBe(0);
    expect(JSON.parse(readFileSync(path, "utf8")).custom).toBeUndefined();
    expect(existsSync(join(home, ".ringko", "settings.local.json"))).toBe(false);
    expect(existsSync(join(home, ".ringko", "provider.json"))).toBe(false);
  });

  it("reports initialization failures and preserves the existing configuration", async () => {
    const path = join(home, ".ringko", "provider.json"); mkdirSync(path, { recursive: true });
    const result = collect(); expect(await runCli(["info"], result.io)).toBe(2);
    expect(result.err.join(" ")).toContain("regular file"); expect(existsSync(join(home, ".ringko", "settings.local.json"))).toBe(false);
  });

  it("rejects empty or missing configuration option values before initializing user files", async () => {
    for (const args of [["run", "hello", "--config", ""], ["config", "show", "--config", "--workspace", home]]) {
      const result = collect(); expect(await runCli(args, result.io)).toBe(2); expect(result.err.join(" ")).toContain("Missing value for --config");
    }
    expect(existsSync(join(home, ".ringko", "settings.local.json"))).toBe(false);
  });
  it("prints the version", async () => {
    const { io, out } = collect();
    expect(await runCli(["version"], io)).toBe(0);
    expect(out).toEqual([`ringko ${VERSION}`]);
  });

  it("prints help when asked", async () => {
    const { io, out } = collect();
    expect(await runCli(["help"], io)).toBe(0);
    expect(out.join("\n")).toContain("Usage:");
  });

  it("prints help for --help", async () => {
    const { io, out } = collect();
    expect(await runCli(["--help"], io)).toBe(0);
    expect(out.join("\n")).toContain("Usage:");
  });

  it("parses global options before the default command", () => {
    const cli = join(import.meta.dir, "..", "src", "cli.ts");
    const result = Bun.spawnSync([process.execPath, cli, "--session", "abc", "--workspace", home], {
      env: { ...process.env, RINGKO_HOME: home },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(1);
    const err = result.stderr.toString();
    expect(err).toContain("requires an interactive terminal");
    expect(err).not.toContain("Unknown command");
  });

  it("starts the terminal UI when no command is given", () => {
    const cli = join(import.meta.dir, "..", "src", "cli.ts");
    const result = Bun.spawnSync([process.execPath, cli], {
      env: { ...process.env, RINGKO_HOME: home },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("requires an interactive terminal");
  });

  it("reports the access mode", async () => {
    const { io, out } = collect();
    expect(await runCli(["info"], io)).toBe(0);
    expect(out[0]).toContain("approval");
  });

  it("lists and trusts plugins without touching other settings", async () => {
    const previousAgents = process.env.AGENTS_HOME;
    process.env.AGENTS_HOME = home;
    const plugin = join(home, ".ringko", "plugins", "demo");
    mkdirSync(plugin, { recursive: true });
    writeFileSync(join(plugin, "plugin.json"), JSON.stringify({ name: "demo" }));
    try {
      let result = collect();
      expect(await runCli(["plugins", "--workspace", home], result.io)).toBe(0);
      expect(result.out).toEqual(["demo\tringko\tglobal\tuntrusted"]);

      result = collect();
      expect(await runCli(["plugins", "trust", "demo", "--workspace", home], result.io)).toBe(0);
      expect(result.out[0]).toContain("Trusted plugin demo");

      result = collect();
      expect(await runCli(["plugins", "--workspace", home], result.io)).toBe(0);
      expect(result.out).toEqual(["demo\tringko\tglobal\ttrusted"]);

      result = collect();
      expect(await runCli(["plugins", "untrust", "demo", "--workspace", home], result.io)).toBe(0);
      result = collect();
      expect(await runCli(["plugins", "--workspace", home], result.io)).toBe(0);
      expect(result.out).toEqual(["demo\tringko\tglobal\tuntrusted"]);
    } finally {
      if (previousAgents === undefined) delete process.env.AGENTS_HOME;
      else process.env.AGENTS_HOME = previousAgents;
    }
  });

  it("lists the registered workspace tools", async () => {
    const { io, out } = collect();
    expect(await runCli(["tools"], io)).toBe(0);
    expect(out).toContain("read");
    expect(out).toContain("write");
    expect(out).toContain("grep");
    expect(out).toContain("tree");
  });

  it("runs the offline echo provider when none is configured", async () => {
    const { io, out } = collect();
    expect(await runCli(["run", "hello", "world"], io)).toBe(0);
    expect(out).toEqual(["echo: hello world"]);
  });

  it("requires a prompt for run", async () => {
    const { io, err } = collect();
    expect(await runCli(["run"], io)).toBe(1);
    expect(err.join("\n")).toContain("requires a prompt");
  });

  it("uses catalog capacity for compaction in both run and loop", async () => {
    const previousUrl = process.env.RINGKO_MODELS_URL;
    let compactions = 0;
    const provider = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      if (new URL(request.url).pathname === "/catalog.json") return Response.json({ fixture: { models: { capacity: { limit: { context: 8192, input: 6000, output: 16_384 } } } } });
      const body = await request.json();
      const compacting = body.messages.some((message: { content?: string }) => message.content?.startsWith("You compact an agent conversation."));
      if (compacting) compactions++;
      const content = compacting ? "Short summary" : "done";
      if (!body.stream) return Response.json({ id: "fixture", model: "fixture", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] });
      return new Response(`data: ${JSON.stringify({ id: "fixture", model: "fixture", choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "fixture", model: "fixture", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    } });
    process.env.RINGKO_MODELS_URL = `http://127.0.0.1:${provider.port}/catalog.json`;
    const cache = new ModelCatalogCache({ onError: () => {} });
    try {
      expect(await cache.refresh(true)).toBe(true);
      saveConfig({ model: "Fixture/fixture", providers: [{ name: "Fixture", type: "openai-compatible", baseURL: `http://127.0.0.1:${provider.port}/v1`, apiKey: "fixture", models: [{ id: "fixture", name: "Fixture", catalogId: "fixture/capacity" }] }], compaction: { keepRecent: 2, margin: 0 } });
      const store = new SessionStore({ cwd: home });
      for (const command of ["run", "loop"]) {
        const session = store.create();
        for (let index = 0; index < 6; index++) { recordUserMessage(session, "Earlier input ".repeat(500)); recordAssistantMessage(session, index + 1, "Earlier output ".repeat(500), []); }
        const id = session.id; session.close();
        const { io, out } = collect();
        expect(await runCli([command, "Continue", ...(command === "loop" ? ["--max-iterations", "1"] : []), "--session", id, "--workspace", home], io)).toBe(0);
        expect(out).toEqual(["done"]);
        const reader = store.open(id, "read");
        try { expect(reader.all().some(event => event.type === "session/compaction")).toBe(true); }
        finally { reader.close(); }
      }
      expect(compactions).toBe(2);
    } finally { cache.dispose(); provider.stop(true); if (previousUrl === undefined) delete process.env.RINGKO_MODELS_URL; else process.env.RINGKO_MODELS_URL = previousUrl; }
  });

  it("rejects an unknown command", async () => {
    const { io, err } = collect();
    expect(await runCli(["bogus"], io)).toBe(1);
    expect(err.join("\n")).toContain("Unknown command");
  });

  it("reports an unknown provider from the configured module", async () => {
    const { io, err } = collect();
    expect(await runCli(["run", "x", "--provider", "nope", "--model", "m"], io)).toBe(1);
    expect(err.join("\n")).toContain('Unknown provider "nope"');
  });

  it("fails when an explicit config file is missing", async () => {
    const { io, err } = collect();
    expect(await runCli(["run", "x", "--config", "definitely-missing.json"], io)).toBe(2);
    expect(err.join("\n")).toContain("Cannot read config");
  });
});

describe("ringko config", () => {
  it("prints the config file paths", async () => {
    const { io, out } = collect();
    expect(await runCli(["config", "path"], io)).toBe(0);
    expect(out).toEqual([
      join(home, ".ringko", "settings.local.json"),
      join(home, ".ringko", "provider.json"),
    ]);
  });

  it("sets, gets, and unsets keys", async () => {
    const set = collect();
    expect(await runCli(["config", "set", "provider.name", "echo"], set.io)).toBe(0);

    const get = collect();
    expect(await runCli(["config", "get", "provider.name"], get.io)).toBe(0);
    expect(get.out[0]).toBe('"echo"');

    const unset = collect();
    expect(await runCli(["config", "unset", "provider.name"], unset.io)).toBe(0);

    const after = collect();
    expect(await runCli(["config", "get", "provider.name"], after.io)).toBe(0);
    expect(after.out[0]).toBe("");
  });
});
