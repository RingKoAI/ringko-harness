import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile, open } from "node:fs/promises";
import { renameSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeTool } from "@ringko-ai/harness";
import { createEditTool, createWriteTool, createGlobTool, createWorkspace } from "../src/index.ts";
import { FILE_LIMITS } from "../src/limits.ts";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "rkh-safe-files-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it("keeps literal replacement syntax and rejects expanded output before allocating it", async () => {
  const path = join(root, "edit.txt"), tool = createEditTool(createWorkspace(root));
  await writeFile(path, "hello");
  await executeTool(tool, { path: "edit.txt", old_string: "ell", new_string: "$&" }, async () => true);
  expect(await readFile(path, "utf8")).toBe("h$&o");
  await writeFile(path, "x".repeat(100));
  await expect(executeTool(createEditTool(createWorkspace(root)), { path: "edit.txt", old_string: "x", new_string: "y".repeat(FILE_LIMITS.editArgumentBytes), replace_all: true }, async () => true)).rejects.toThrow("output limit");
  expect(await readFile(path, "utf8")).toBe("x".repeat(100));
});

it("rejects large edit sources and leaves the original intact", async () => {
  const path = join(root, "large.txt"), file = await open(path, "w");
  try { await file.truncate(FILE_LIMITS.sourceBytes + 1); } finally { await file.close(); }
  await expect(executeTool(createEditTool(createWorkspace(root)), { path: "large.txt", old_string: "absent", new_string: "x" }, async () => true)).rejects.toThrow("size limit");
  const reopened = await open(path); try { expect((await reopened.stat()).size).toBe(FILE_LIMITS.sourceBytes + 1); } finally { await reopened.close(); }
  expect((await readdir(root)).filter(name => name.startsWith(".ringko-write-"))).toEqual([]);
});

it("does not overwrite a target that appeared after new-file approval", async () => {
  const tool = createWriteTool(createWorkspace(root)), input = { path: "new.txt", content: "unexpected" };
  const risk = await tool.assessRisk(input);
  expect(risk.targetExists).toBe(false);
  await writeFile(join(root, "new.txt"), "concurrent creation");
  await expect(tool.execute(input, { approvedTarget: risk.target, approvedTargetExists: false })).rejects.toThrow("appeared after approval");
  expect(await readFile(join(root, "new.txt"), "utf8")).toBe("concurrent creation");
});

it("does not follow a directory replaced at the commit checkpoint", async () => {
  const workspace = join(root, "workspace"), directory = join(workspace, "sub"), outside = join(root, "outside");
  await mkdir(directory, { recursive: true }); await mkdir(outside);
  await writeFile(join(directory, "file.txt"), "inside"); await writeFile(join(outside, "file.txt"), "outside");
  const tool = createEditTool(createWorkspace(workspace)), input = { path: "sub/file.txt", old_string: "inside", new_string: "changed", replace_all: false };
  const risk = await tool.assessRisk(input), controller = new AbortController();
  let checkpoints = 0, attempted = false;
  controller.signal.throwIfAborted = () => {
    // execute -> dispatch -> prepared commit while native ancestry stays pinned.
    if (++checkpoints !== 3) return;
    attempted = true;
    renameSync(directory, `${directory}-old`);
    symlinkSync(outside, directory, process.platform === "win32" ? "junction" : "dir");
  };
  try { await tool.execute(input, { approvedTarget: risk.target, signal: controller.signal }); } catch { /* Sharing denial or changed-target refusal is safe. */ }
  expect(attempted).toBe(true);
  expect(await readFile(join(outside, "file.txt"), "utf8")).toBe("outside");
});

it("preserves approved in-workspace aliases while rejecting escaping patterns", async () => {
  await mkdir(join(root, "real")); await writeFile(join(root, "real", "a.txt"), "old");
  await symlink(join(root, "real"), join(root, "alias"), process.platform === "win32" ? "junction" : "dir");
  await executeTool(createEditTool(createWorkspace(root)), { path: "alias/a.txt", old_string: "old", new_string: "new" }, async () => true);
  expect(await readFile(join(root, "real", "a.txt"), "utf8")).toBe("new");
  const tool = createGlobTool(createWorkspace(root));
  for (const pattern of [join(root, "**", "*.txt"), "../*.txt", "{../outside,real}/*.txt"]) await expect(executeTool(tool, { pattern })).rejects.toThrow("relative");
});
