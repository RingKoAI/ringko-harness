import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMcpServers } from "../src/mcp.ts";

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
    expect(loadMcpServers({ env })).toEqual([]);
  });

  it("merges both roots with ringko taking precedence", () => {
    writeMcp(".ringko", JSON.stringify({ mcpServers: { a: { command: "a-cmd" }, shared: { command: "ringko" } } }));
    writeMcp(".agents", JSON.stringify({ mcpServers: { b: { command: "b-cmd" }, shared: { command: "agents" } } }));

    const servers = loadMcpServers({ env });
    expect(servers.map((server) => server.name).sort()).toEqual(["a", "b", "shared"]);
    expect(servers.find((server) => server.name === "shared")?.config.command).toBe("ringko");
    expect(servers.find((server) => server.name === "shared")?.source).toBe("ringko");
    expect(servers.find((server) => server.name === "b")?.source).toBe("agents");
  });

  it("rejects invalid JSON and wrong shapes", () => {
    writeMcp(".ringko", "{");
    expect(() => loadMcpServers({ env })).toThrow("not valid JSON");

    writeMcp(".ringko", JSON.stringify({ mcpServers: [] }));
    expect(() => loadMcpServers({ env })).toThrow('"mcpServers" must be an object');
  });
});
