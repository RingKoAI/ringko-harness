import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { createWorkspace } from "./workspace.ts";

describe("workspace boundary", () => {
  const root = resolve("/srv/app");
  const workspace = createWorkspace(root);

  it("resolves a relative path inside the workspace", () => {
    const target = workspace.resolve("src/index.ts");
    expect(target.insideWorkspace).toBe(true);
    expect(target.relative).toBe("src/index.ts");
  });

  it("normalises traversal that stays inside the workspace", () => {
    const target = workspace.resolve("src/../index.ts");
    expect(target.insideWorkspace).toBe(true);
    expect(target.relative).toBe("index.ts");
  });

  it("treats the workspace root itself as inside", () => {
    const target = workspace.resolve(".");
    expect(target.insideWorkspace).toBe(true);
    expect(target.relative).toBe("");
  });

  it("classifies parent traversal as outside", () => {
    expect(workspace.resolve("../secrets.txt").insideWorkspace).toBe(false);
    expect(workspace.resolve("src/../../secrets.txt").insideWorkspace).toBe(false);
  });

  it("classifies an absolute external path as outside", () => {
    expect(workspace.resolve(resolve("/etc/passwd")).insideWorkspace).toBe(false);
  });

  it("rejects an empty root or target", () => {
    expect(() => createWorkspace("  ")).toThrow("non-empty path");
    expect(() => workspace.resolve("")).toThrow("target path is required");
  });
});
