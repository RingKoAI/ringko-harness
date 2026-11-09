import { afterEach, beforeEach, expect, it } from "bun:test";
import { createRequire } from "node:module";
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeFileBinding } from "../src/native-file-loader.ts";
import { executeTool } from "@ringko-ai/harness";
import { createEditTool, createWriteTool, createWorkspace } from "../src/index.ts";
import { safeFileOperation } from "../src/file-operation.ts";
import { spawn } from "node:child_process";
import { acquireFileLock } from "../src/file-lock.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

let root: string;
beforeEach(async () => { root = await realpath(await mkdtemp(join(tmpdir(), "rkh-native-binding-"))); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it("validates opaque transactions and rejects unsafe native call ordering", async () => {
  const native = createRequire(import.meta.url)(nativeFileBinding());
  expect(() => native.info({})).toThrow("Invalid native");
  const path = join(root, "a.txt"); await writeFile(path, "original");
  const transaction = native.begin(path, "write", false);
  try {
    expect(() => native.commit(transaction)).toThrow("Invalid native");
    expect(() => native.stage(transaction, "../unsafe")).toThrow("Invalid native");
    native.stage(transaction, ".ringko-write-a.tmp");
    expect(() => native.stage(transaction, ".ringko-write-b.tmp")).toThrow("Invalid native");
    expect(() => native.write(transaction, Buffer.alloc(65537))).toThrow("Invalid native");
  } finally { native.close(transaction); }
  expect(() => native.close(transaction)).not.toThrow();
  expect(() => native.info(transaction)).toThrow("Invalid native");
  expect(await readdir(root)).toEqual(["a.txt"]);
  expect(await readFile(path, "utf8")).toBe("original");
});

it("preserves literal replacement text and empty-file writes through the actual binding", async () => {
  const workspace = createWorkspace(root);
  await executeTool(createWriteTool(workspace), { path: "empty.txt", content: "" });
  expect(await readFile(join(root, "empty.txt"), "utf8")).toBe("");
  await writeFile(join(root, "literal.txt"), "hello");
  await executeTool(createEditTool(workspace), { path: "literal.txt", old_string: "ell", new_string: "$&" }, async () => true);
  expect(await readFile(join(root, "literal.txt"), "utf8")).toBe("h$&o");
});

it("isolates native state across concurrent workers and exclusively creates a shared destination", async () => {
  await Promise.all(Array.from({ length: 6 }, (_, index) => safeFileOperation(join(root, `${index}.txt`), { kind: "write", content: String(index), expectAbsent: true })));
  for (let index = 0; index < 6; index++) expect(await readFile(join(root, `${index}.txt`), "utf8")).toBe(String(index));
  const destination = join(root, "exclusive.txt");
  const results = await Promise.allSettled(["first", "second"].map(content => safeFileOperation(destination, { kind: "write", content, expectAbsent: true })));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(["first", "second"]).toContain(await readFile(destination, "utf8"));
  expect((await readdir(root)).some(name => name.startsWith(".ringko-write-"))).toBe(false);
});

it("loads the same module in the standard Node host without a Bun FFI bridge", async () => {
  const executable = Bun.which("node");
  if (!executable) throw new Error("Node.js is a documented runtime prerequisite.");
  const child = spawn(executable, [join(import.meta.dir, "fixtures", "native-file-host.mjs"), nativeFileBinding(), root], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
  const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  expect(stderr).toBe(""); expect(code).toBe(0); expect(stdout).toContain("Node-API host verified");
});

it("excludes another process and releases the kernel lock when that process exits", async () => {
  const executable = Bun.which("node"); if (!executable) throw new Error("Node.js is required.");
  const child = spawn(executable, [join(import.meta.dir, "fixtures", "native-file-host.mjs"), nativeFileBinding(), root, "lock"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let output = "", errors = "";
  const exited = new Promise<void>(resolve => { child.once("close", () => resolve()); });
  child.stderr.on("data", chunk => { errors += chunk; });
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", code => { if (!output.includes("lock held")) reject(new Error(`Lock holder exited (${code}): ${errors}`)); });
      child.stdout.on("data", chunk => { output += chunk; if (output.includes("lock held")) resolve(); });
    });
    await expect(acquireFileLock(join(root, "coordination.lock"))).rejects.toMatchObject({ code: "EBUSY" });
  } finally { child.kill("SIGKILL"); await exited; }
  const release = await acquireFileLock(join(root, "coordination.lock")); await release();
});

it("keeps a local reservation and kernel lease across unrelated native worker cleanup", async () => {
  const path = join(root, "coordination.lock"), release = await acquireFileLock(path);
  try {
    await expect(acquireFileLock(path)).rejects.toMatchObject({ code: "EBUSY" });
    await safeFileOperation(join(root, "unrelated.txt"), { kind: "write", content: "fixture" });
    const executable = Bun.which("node"); if (!executable) throw new Error("Node.js is required.");
    const result = await promisify(execFile)(executable, [join(import.meta.dir, "fixtures", "native-file-host.mjs"), nativeFileBinding(), root, "probe-lock"]);
    expect(result.stdout).toContain("Node-API lock excluded");
  } finally { await release(); }
  const reacquired = await acquireFileLock(path); await reacquired();
});
