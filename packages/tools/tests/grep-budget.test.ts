import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeTool } from "@ringko-ai/harness";
import { createGrepTool } from "../src/grep.ts";
import { createWorkspace } from "../src/workspace.ts";
import { SearchBudget } from "../src/search-budget.ts";
import { SEARCH_LIMITS } from "../src/limits.ts";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "rkh-grep-budget-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it("terminates pathological matching without freezing the host event loop", async () => {
  await writeFile(join(root, "payload.txt"), ("a".repeat(32) + "!\n").repeat(100));
  let ticks = 0;
  const timer = setInterval(() => ticks++, 10), start = Date.now();
  try {
    await expect(executeTool(createGrepTool(createWorkspace(root)), { path: "payload.txt", pattern: "(a+)+$" })).rejects.toThrow("deadline");
  } finally { clearInterval(timer); }
  expect(ticks).toBeGreaterThan(5);
  expect(Date.now() - start).toBeLessThan(SEARCH_LIMITS.totalMs);
});

it("accounts cumulative reads and rejects the first byte or file over budget", () => {
  const budget = new SearchBudget({ totalBytes: 10, files: 2 });
  budget.file(); budget.consume(5); budget.file(); budget.consume(5);
  expect(() => budget.consume(1)).toThrow("cumulative byte budget");
  expect(() => budget.file()).toThrow("file-count budget");
});

it("skips an oversized source before allocating its contents and preserves UTF-8 byte limits", async () => {
  const file = await open(join(root, "large.txt"), "w");
  try { await file.truncate(64 * 1024 * 1024); } finally { await file.close(); }
  await writeFile(join(root, "unicode.txt"), "中".repeat(Math.ceil(SEARCH_LIMITS.fileBytes / 3) + 1));
  await writeFile(join(root, "small.txt"), "needle");
  const result = await executeTool(createGrepTool(createWorkspace(root)), { pattern: "needle|中" });
  expect(result.matches).toEqual([{ file: "small.txt", line: 1, text: "needle" }]);
});

it("rejects traversal globs and cancels a running regex worker", async () => {
  const tool = createGrepTool(createWorkspace(root));
  await expect(executeTool(tool, { pattern: "x", glob: "../*" })).rejects.toThrow("relative");
  await expect(executeTool(tool, { pattern: "x".repeat(SEARCH_LIMITS.patternCharacters + 1) })).rejects.toThrow("4096");
  await writeFile(join(root, "payload.txt"), ("a".repeat(32) + "!\n").repeat(100));
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(new Error("review cancellation")), 100);
  try { await expect(executeTool(tool, { pattern: "(a+)+$" }, undefined, "approval", { signal: controller.signal })).rejects.toThrow("review cancellation"); }
  finally { clearTimeout(timer); }
});
