import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMcpServers } from "../src/mcp.ts";
import { discoverSkills } from "../src/skills.ts";
import { expandCommandPrompt, loadPlugins } from "../src/plugins.ts";

let home: string;
let env: NodeJS.ProcessEnv;

function writePlugin(root: string, id: string, manifest: unknown, skills?: Record<string, string>): string {
  const dir = join(root, "plugins", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plugin.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
  for (const [name, body] of Object.entries(skills ?? {})) {
    const skillDir = join(dir, "skills", name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), body);
  }
  return dir;
}

function writeSettings(value: unknown): void {
  mkdirSync(join(home, ".ringko"), { recursive: true });
  writeFileSync(join(home, ".ringko", "settings.local.json"), JSON.stringify(value));
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ringko-plugins-"));
  env = { RINGKO_HOME: home, AGENTS_HOME: home } as NodeJS.ProcessEnv;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("loadPlugins", () => {
  it("ignores untrusted plugins without reading their manifests", () => {
    writePlugin(join(home, ".ringko"), "hidden", "not json");
    expect(loadPlugins({ env, cwd: home })).toEqual({ plugins: [], errors: [] });
  });

  it("loads commands, MCP servers and skill directories for a trusted plugin", () => {
    writePlugin(join(home, ".ringko"), "reviewer", {
      schemaVersion: 1,
      name: "reviewer",
      version: "1.0.0",
      description: "Review helpers",
      commands: [{ name: "review", description: "Review a diff", prompt: "Review this: $ARGUMENTS", argumentHint: "path" }],
      mcpServers: { reviewer: { command: "node", args: ["server.js"] } },
    }, {
      focus: "---\nname: reviewer-focus\ndescription: Focused review\n---\nBody",
    });

    const result = loadPlugins({ env, cwd: home, trusted: ["reviewer"] });
    expect(result.errors).toEqual([]);
    expect(result.plugins).toHaveLength(1);
    const plugin = result.plugins[0];
    expect(plugin.id).toBe("reviewer");
    expect(plugin.source).toBe("ringko");
    expect(plugin.scope).toBe("global");
    expect(plugin.commands).toEqual([{ name: "review", description: "Review a diff", prompt: "Review this: $ARGUMENTS", argumentHint: "path" }]);
    expect(plugin.mcpServers).toEqual({ reviewer: { command: "node", args: ["server.js"] } });
    expect(plugin.skillDirs).toHaveLength(1);
    expect(plugin.skillDirs[0].endsWith(join("skills"))).toBe(true);
  });

  it("reads trust from user settings and gives project plugins precedence", () => {
    writeSettings({ plugins: { trusted: ["shared"] } });
    writePlugin(join(home, ".ringko"), "shared", { name: "shared", description: "user" });
    const project = mkdtempSync(join(tmpdir(), "ringko-plugin-proj-"));
    mkdirSync(join(project, ".git"));
    writePlugin(join(project, ".ringko"), "shared", { name: "shared", description: "project" });
    try {
      const result = loadPlugins({ env, cwd: project });
      expect(result.plugins.map(plugin => plugin.id)).toEqual(["shared"]);
      expect(result.plugins[0].source).toBe("project");
      expect(result.plugins[0].manifest.description).toBe("project");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("rejects malformed manifests as a whole", () => {
    writePlugin(join(home, ".ringko"), "bad-name", { name: "other" });
    writePlugin(join(home, ".ringko"), "hooks", { name: "hooks", hooks: { "run/before": [] } });
    writePlugin(join(home, ".ringko"), "unknown", { name: "unknown", extra: true });
    writePlugin(join(home, ".ringko"), "escape", { name: "escape", skills: ["../outside"] });
    writePlugin(join(home, ".ringko"), "missing", { name: "missing", skills: ["nope"] });
    writePlugin(join(home, ".ringko"), "dupe", { name: "dupe", commands: [{ name: "a", prompt: "x" }, { name: "a", prompt: "y" }] });
    writePlugin(join(home, ".ringko"), "proto", '{"name":"proto","mcpServers":{"__proto__":{"command":"x"}}}');

    const result = loadPlugins({ env, cwd: home, trusted: ["bad-name", "hooks", "unknown", "escape", "missing", "dupe", "proto"] });
    expect(result.plugins).toEqual([]);
    expect(result.errors.map(error => error.message)).toEqual([
      'Plugin name must match its directory (expected "bad-name").',
      'Duplicate plugin command "a".',
      'Plugin skill path "../outside" escapes the plugin directory.',
      "Plugin hooks are not supported; use a runtime contribution instead.",
      'Plugin skill directory "nope" does not exist.',
      'Invalid plugin MCP server name "__proto__".',
      'Unknown plugin field "extra".',
    ]);
  });

  it("reports trust configuration errors without loading anything", () => {
    writeSettings({ plugins: { trusted: "reviewer" } });
    writePlugin(join(home, ".ringko"), "reviewer", { name: "reviewer" });
    const result = loadPlugins({ env, cwd: home });
    expect(result.plugins).toEqual([]);
    expect(result.errors[0]?.source).toBe("plugins");
    expect(result.errors[0]?.message).toContain("array");
  });

  it("merges plugin MCP servers without overriding explicit configuration", () => {
    writeSettings({ plugins: { trusted: ["reviewer"] } });
    writePlugin(join(home, ".ringko"), "reviewer", {
      name: "reviewer",
      mcpServers: { shared: { command: "plugin" }, extra: { command: "extra" } },
    });
    writeFileSync(join(home, ".ringko", ".mcp.json"), JSON.stringify({ mcpServers: { shared: { command: "explicit" } } }));
    const servers = loadMcpServers({ env, cwd: home });
    expect(servers.map(server => server.name).sort()).toEqual(["extra", "shared"]);
    expect(servers.find(server => server.name === "shared")?.config.command).toBe("explicit");
    expect(servers.find(server => server.name === "extra")?.source).toBe("ringko");
    expect(servers.find(server => server.name === "extra")?.scope).toBe("global");
  });

  it("feeds discovered plugin skills into the skill registry", () => {
    writeSettings({ plugins: { trusted: ["reviewer"] } });
    writePlugin(join(home, ".ringko"), "reviewer", { name: "reviewer" }, {
      focus: "---\nname: plugin-focus\ndescription: From a plugin\n---\nBody",
    });
    const skills = discoverSkills({ env, cwd: home });
    expect(skills.find(skill => skill.name === "plugin-focus")?.source).toBe("ringko");
    expect(skills.find(skill => skill.name === "plugin-focus")?.scope).toBe("global");
  });
});

describe("expandCommandPrompt", () => {
  it("substitutes either placeholder and appends otherwise", () => {
    expect(expandCommandPrompt("Review $ARGUMENTS", "src/a.ts")).toBe("Review src/a.ts");
    expect(expandCommandPrompt("Review {{args}}", "src/a.ts")).toBe("Review src/a.ts");
    expect(expandCommandPrompt("Review the diff", "src/a.ts")).toBe("Review the diff\n\nsrc/a.ts");
    expect(expandCommandPrompt("Review the diff", "  ")).toBe("Review the diff");
  });
});
