import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { agentsRoot, configPath, mcpPaths, ringkoRoot, skillsDirs } from "./paths.ts";

const env = { RINGKO_HOME: join("/home", "u"), AGENTS_HOME: join("/home", "u") } as NodeJS.ProcessEnv;

describe("resource paths", () => {
  it("resolves the ringko and agents roots", () => {
    expect(ringkoRoot(env)).toBe(join("/home/u", ".ringko"));
    expect(agentsRoot(env)).toBe(join("/home/u", ".agents"));
  });

  it("resolves the config path", () => {
    expect(configPath(env)).toBe(join("/home/u", ".ringko", "config"));
  });

  it("lists MCP files with ringko first", () => {
    expect(mcpPaths(env)).toEqual([
      join("/home/u", ".ringko", ".mcp.json"),
      join("/home/u", ".agents", ".mcp.json"),
    ]);
  });

  it("lists skills directories in precedence order", () => {
    const dirs = skillsDirs(env);
    expect(dirs[0]).toBe(join("/home/u", ".ringko", "skills"));
    expect(dirs).toContain(join("/home/u", ".agents", "skills"));
    expect(dirs.length).toBe(4);
  });
});
