import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMcpServerMap, loadMcpServers } from "../src/mcp.ts";

let home: string;
let env: NodeJS.ProcessEnv;

function writeMcp(relDir: string, content: string): void {
  const dir = join(home, relDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".mcp.json"), content);
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ringko-mcp-"));
  env = { RINGKO_HOME: home, AGENTS_HOME: home } as NodeJS.ProcessEnv;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("loadMcpServers", () => {
  it("returns an empty list when no file exists", () => {
    expect(loadMcpServers({ env, cwd: home })).toEqual([]);
  });

  it("merges both roots with ringko taking precedence", () => {
    writeMcp(".ringko", JSON.stringify({ mcpServers: { a: { command: "a-cmd" }, shared: { command: "ringko" } } }));
    writeMcp(".agents", JSON.stringify({ mcpServers: { b: { command: "b-cmd" }, shared: { command: "agents" } } }));

    const servers = loadMcpServers({ env, cwd: home });
    expect(servers.map((server) => server.name).sort()).toEqual(["a", "b", "shared"]);
    expect(servers.find((server) => server.name === "shared")?.config.command).toBe("ringko");
    expect(servers.find((server) => server.name === "shared")?.source).toBe("ringko");
    expect(servers.find((server) => server.name === "b")?.source).toBe("agents");
  });

  it("reads project-level config before global", () => {
    const project = mkdtempSync(join(tmpdir(), "ringko-proj-"));
    const sub = join(project, "app");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { p: { command: "p" } } }));
    writeFileSync(join(project, "ringko.json"), JSON.stringify({ mcpServers: { q: { command: "q" } } }));
    writeMcp(".ringko", JSON.stringify({ mcpServers: { g: { command: "g" } } }));

    const servers = loadMcpServers({ env, cwd: sub });
    const scope = Object.fromEntries(servers.map((server) => [server.name, server.scope]));
    expect(scope.p).toBe("project");
    expect(scope.q).toBe("project");
    expect(scope.g).toBe("global");

    rmSync(project, { recursive: true, force: true });
  });

  it("rejects invalid JSON and wrong shapes", () => {
    writeMcp(".ringko", "{");
    expect(() => loadMcpServers({ env, cwd: home })).toThrow("not valid JSON");

    writeMcp(".ringko", JSON.stringify({ mcpServers: [] }));
    expect(() => loadMcpServers({ env, cwd: home })).toThrow('"mcpServers" must be an object');
  });

  it("does not reflect malformed configuration contents in parser errors", () => {
    const secret = "fixture-mcp-credential-DO_NOT_EXPOSE";
    writeMcp(".ringko", `{"token":"${secret}" invalid}`);
    for (const load of [() => loadMcpServers({ env, cwd: home }), () => loadMcpServerMap(env)]) {
      expect(load).toThrow("not valid JSON");
      expect(load).not.toThrow(secret);
    }
  });

  it("reports an unreadable MCP target instead of treating it as a missing configuration", () => {
    mkdirSync(join(home, ".ringko/.mcp.json"), { recursive: true });
    expect(() => loadMcpServers({ env, cwd: home })).toThrow("Cannot read");
    expect(() => loadMcpServerMap(env)).toThrow("Cannot read");
  });

  it("keeps missing and empty MCP maps valid", () => {
    expect(loadMcpServerMap(env)).toEqual({});
    writeMcp(".ringko", "  \n");
    expect(loadMcpServerMap(env)).toEqual({});
    expect(loadMcpServers({ env, cwd: home })).toEqual([]);
  });

  it("rejects broken MCP links instead of silently ignoring their configuration", () => {
    mkdirSync(join(home, ".ringko"));
    const target = join(home, "missing.json"), link = join(home, ".ringko/.mcp.json");
    if (process.platform === "win32") {
      // Junctions exercise the same dangling-target branch without requiring
      // the Windows file-symlink privilege on development machines.
      mkdirSync(target); symlinkSync(target, link, "junction"); rmSync(target, { recursive: true });
    } else symlinkSync(target, link, "file");
    expect(() => loadMcpServers({ env, cwd: home })).toThrow("Cannot read");
    expect(() => loadMcpServerMap(env)).toThrow("Cannot read");
  });
});
