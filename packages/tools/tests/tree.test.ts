import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ApprovalHandlerUnavailableError, executeTool, ToolRegistry } from "@ringko-ai/harness";
import { createTreeTool, createWorkspace, registerWorkspaceTools } from "../src/index.ts";
import { TREE_LIMITS } from "../src/tree.ts";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "rkh-tree-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const safe = async (): Promise<boolean> => { throw new Error("Workspace tree must not request approval."); };

async function fixture() {
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "index.ts"), "not file contents");
  await writeFile(join(root, "README.md"), "not file contents");
}

describe("native tree", () => {
  it("renders deterministic directories-first structure and relative entry metadata", async () => {
    await fixture();
    const result = await executeTool(createTreeTool(createWorkspace(root)), {}, safe);
    expect(result.tree).toBe(".\n├── src/\n│   └── index.ts\n└── README.md");
    expect(result.entries.map(entry => entry.path)).toEqual(["src", "src/index.ts", "README.md"]);
    expect(result).toMatchObject({ directories: 1, files: 2, symlinks: 0, truncated: false });
    expect(result.tree).not.toContain("not file contents");
  });

  it("supports an explicit subtree and an empty directory", async () => {
    await fixture(); await mkdir(join(root, "empty"));
    const tool = createTreeTool(createWorkspace(root));
    expect((await executeTool(tool, { path: "src" }, safe)).tree).toBe("src\n└── index.ts");
    expect(await executeTool(tool, { path: "empty" }, safe)).toMatchObject({ tree: "empty", entries: [], truncated: false });
  });

  it("filters hidden entries and dependency/build trees, with explicit overrides", async () => {
    await Promise.all([mkdir(join(root, "node_modules")), mkdir(join(root, "dist")), mkdir(join(root, ".github"))]);
    await writeFile(join(root, ".env"), "fixture"); await writeFile(join(root, "visible"), "fixture");
    const tool = createTreeTool(createWorkspace(root));
    expect((await executeTool(tool, {}, safe)).entries.map(entry => entry.path)).toEqual(["visible"]);
    const all = await executeTool(tool, { include_hidden: true, exclude: [] }, safe);
    expect(all.entries.map(entry => entry.path)).toEqual([".github", "dist", "node_modules", ".env", "visible"]);
    const filtered = await executeTool(tool, { include_hidden: true, exclude: [".env", "node_modules", "dist"] }, safe);
    expect(filtered.entries.map(entry => entry.path)).toEqual([".github", "visible"]);
  });

  it("lists directories only with correct branch connectors", async () => {
    await fixture(); await mkdir(join(root, "z-dir"));
    const result = await executeTool(createTreeTool(createWorkspace(root)), { directories_only: true }, safe);
    expect(result.tree).toBe(".\n├── src/\n└── z-dir/");
    expect(result.files).toBe(0);
  });

  it("reports depth and entry truncation without discarding source files", async () => {
    await fixture();
    const tool = createTreeTool(createWorkspace(root));
    const shallow = await executeTool(tool, { max_depth: 1 }, safe);
    expect(shallow.entries.map(entry => entry.path)).toEqual(["src", "README.md"]);
    expect(shallow.entries[0].children_truncated).toBe(true);
    expect(shallow.truncation_reasons).toContain("max_depth");
    const limited = await executeTool(tool, { max_entries: 1 }, safe);
    expect(limited.entries).toHaveLength(1);
    expect(limited.truncation_reasons).toContain("max_entries");
    expect((await executeTool(tool, { max_depth: 0 }, safe)).entries).toEqual([]);
    expect((await executeTool(tool, {}, safe)).files).toBe(2);
  });

  it("bounds both the formatted preview and structured metadata for wide trees", async () => {
    await Promise.all(Array.from({ length: 400 }, (_, index) => writeFile(join(root, `${String(index).padStart(4, "0")}-${"long-name".repeat(20)}.txt`), "")));
    const result = await executeTool(createTreeTool(createWorkspace(root)), { max_entries: TREE_LIMITS.maxEntries }, safe);
    expect(result.truncation_reasons).toContain("output_limit");
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(TREE_LIMITS.outputCharacters);
    expect(result.entries.length).toBeLessThan(400);
  });

  it("never follows nested junctions, external links or cycles", async () => {
    const workspace = join(root, "workspace"), outside = join(root, "outside");
    await mkdir(workspace); await mkdir(outside); await writeFile(join(outside, "private-file"), "secret fixture");
    const type = process.platform === "win32" ? "junction" : "dir";
    await symlink(outside, join(workspace, "external"), type);
    await symlink(workspace, join(workspace, "loop"), type);
    const result = await executeTool(createTreeTool(createWorkspace(workspace)), {}, safe);
    expect(result.symlinks).toBe(2);
    expect(result.tree).toContain("symlink; not followed");
    expect(result.tree).not.toContain("private-file");
    expect(result.entries).toHaveLength(2);
  });

  it("requires external approval for a root junction and rechecks its target afterwards", async () => {
    const workspace = join(root, "workspace"), outside = join(root, "outside"), other = join(root, "other");
    await Promise.all([mkdir(workspace), mkdir(outside), mkdir(other)]);
    await writeFile(join(outside, "outside-file"), "");
    const link = join(workspace, "linked");
    const type = process.platform === "win32" ? "junction" : "dir";
    await symlink(outside, link, type);
    const tool = createTreeTool(createWorkspace(workspace));
    await expect(executeTool(tool, { path: "linked" })).rejects.toBeInstanceOf(ApprovalHandlerUnavailableError);
    const approved = await executeTool(tool, { path: "linked" }, async request => { expect(request.riskKind).toBe("external_file"); return true; });
    expect(approved.tree).toContain("outside-file");
    await expect(executeTool(tool, { path: "linked" }, async () => {
      await rm(link); await symlink(other, link, type); return true;
    })).rejects.toThrow("target changed after approval");
  });

  it("registers as a read capability and does not require a shell or PATH", async () => {
    await fixture();
    const registry = new ToolRegistry(); registerWorkspaceTools(registry, { workspace: root });
    expect(registry.list().find(tool => tool.name === "tree")?.taskAccess).toBe("read");
    expect(registry.has("shell")).toBe(false);
    const module = pathToFileURL(join(import.meta.dir, "../src/tree.ts")).href;
    const workspaceModule = pathToFileURL(join(import.meta.dir, "../src/workspace.ts")).href;
    const script = `import {createTreeTool} from ${JSON.stringify(module)};import {createWorkspace} from ${JSON.stringify(workspaceModule)};const tool=createTreeTool(createWorkspace(${JSON.stringify(root)}));console.log((await tool.execute({})).tree);`;
    const child = Bun.spawnSync([process.execPath, "-e", script], { cwd: root, env: { ...process.env, PATH: "" } });
    expect(child.exitCode).toBe(0);
    expect(child.stdout.toString()).toContain("index.ts");
  });

  it("rejects malformed or excessive inputs and propagates missing/non-directory errors", async () => {
    await fixture(); const tool = createTreeTool(createWorkspace(root));
    for (const input of [null, [], { path: "" }, { path: "a\0b" }, { max_depth: -1 }, { max_depth: TREE_LIMITS.maxDepth + 1 }, { max_depth: 1.5 }, { max_entries: 0 }, { max_entries: TREE_LIMITS.maxEntries + 1 }, { include_hidden: "yes" }, { directories_only: 1 }, { exclude: ["../outside"] }, { exclude: Array(65).fill("x") }, { unexpected: true }]) {
      await expect(executeTool(tool, input, safe)).rejects.toBeInstanceOf(TypeError);
    }
    await expect(executeTool(tool, { path: "missing" }, safe)).rejects.toThrow();
    await expect(executeTool(tool, { path: "README.md" }, safe)).rejects.toThrow("directory");
  });

  it("honors cancellation without returning a successful partial result", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(executeTool(createTreeTool(createWorkspace(root)), {}, safe, "approval", { signal: controller.signal })).rejects.toThrow();
  });
});
