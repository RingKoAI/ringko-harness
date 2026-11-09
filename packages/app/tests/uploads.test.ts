import { afterEach, beforeEach, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { safeFileOperation } from "@ringko-ai/tools";
import { UploadError, UploadManager, UPLOAD_LOCK_NAME } from "../src/services/uploads.ts";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "rkh-upload-limits-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
function request(files: { name: string; data: Uint8Array | string }[], headers?: HeadersInit): Request {
  const form = new FormData();
  for (const file of files) form.append("file", new File([typeof file.data === "string" ? file.data : new Uint8Array(file.data)], file.name));
  return new Request("http://fixture/api/upload", { method: "POST", body: form, headers });
}
const storedEntries = async (directory: string) => (await readdir(directory)).filter(name => name !== UPLOAD_LOCK_NAME);

it("preserves binary uploads and gives same-named files unique safe paths", async () => {
  const manager = new UploadManager();
  const bytes = new Uint8Array([0, 255, 127, 42]);
  const files = await manager.receive(request([{ name: "same.bin", data: bytes }, { name: "same.bin", data: "second" }]), root);
  expect(files).toHaveLength(2); expect(files[0]!.path).not.toBe(files[1]!.path);
  expect(await readFile(join(root, files[0]!.path))).toEqual(Buffer.from(bytes));
  expect(await readFile(join(root, files[1]!.path), "utf8")).toBe("second");
  await manager.close();
});

it("rejects file and request byte limits before persisting any data", async () => {
  expect(() => new UploadManager({ timeoutMs: 2_147_483_648 })).toThrow("Invalid upload limits");
  const manager = new UploadManager({ fileBytes: 16 });
  await expect(manager.receive(request([{ name: "large", data: "x".repeat(17) }]), root)).rejects.toMatchObject({ status: 413 });
  expect(existsSync(join(root, ".ringko"))).toBe(false);
  const smallBody = new UploadManager({ requestBytes: 32 });
  await expect(smallBody.receive(request([{ name: "small", data: "x" }]), root)).rejects.toMatchObject({ status: 413 });
  await expect(manager.receive(request([{ name: "small", data: "x" }], { "content-length": "999999999" }), root)).rejects.toMatchObject({ status: 413 });
  const exact = await manager.receive(request([{ name: "exact", data: "x".repeat(16) }]), root);
  expect(exact).toHaveLength(1);
});

it("serializes quota checks so concurrent requests cannot overfill storage", async () => {
  const manager = new UploadManager({ workspaceBytes: 10 });
  const results = await Promise.allSettled([
    manager.receive(request([{ name: "a", data: "123456" }]), root),
    manager.receive(request([{ name: "b", data: "123456" }]), root),
  ]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const failure = results.find(result => result.status === "rejected");
  expect(failure?.status === "rejected" && failure.reason).toMatchObject({ status: 507 });
  expect(await storedEntries(join(root, ".ringko", "uploads"))).toHaveLength(1);
});

it("rolls back only owned files if the second file cannot be committed", async () => {
  const directory = join(root, ".ringko", "uploads"); await mkdir(directory, { recursive: true }); await writeFile(join(directory, "keep.txt"), "keep");
  let writes = 0;
  const persist: typeof safeFileOperation = async (path, operation, signal) => {
    if (operation.kind === "write" && ++writes === 2) throw new Error("injected disk failure");
    return safeFileOperation(path, operation, signal);
  };
  const manager = new UploadManager({}, persist);
  await expect(manager.receive(request([{ name: "a", data: "a" }, { name: "b", data: "b" }]), root)).rejects.toBeInstanceOf(UploadError);
  expect(await storedEntries(directory)).toEqual(["keep.txt"]);
  expect(await readFile(join(directory, "keep.txt"), "utf8")).toBe("keep");
});

it("rejects upload storage linked outside the workspace", async () => {
  const workspace = join(root, "workspace"), outside = join(root, "outside");
  await mkdir(join(workspace, ".ringko"), { recursive: true }); await mkdir(outside);
  await symlink(outside, join(workspace, ".ringko", "uploads"), process.platform === "win32" ? "junction" : "dir");
  await expect(new UploadManager().receive(request([{ name: "file", data: "secret" }]), workspace)).rejects.toMatchObject({ status: 403 });
  expect(await readdir(outside)).toEqual([]);
});

it("returns canonical in-workspace references for an intentionally linked storage directory", async () => {
  const directory = join(root, "attachments"); await mkdir(directory); await mkdir(join(root, ".ringko"));
  await symlink(directory, join(root, ".ringko", "uploads"), process.platform === "win32" ? "junction" : "dir");
  const files = await new UploadManager().receive(request([{ name: "a", data: "inside" }]), root);
  expect(files[0]!.path.startsWith("attachments/")).toBe(true);
  expect(await readFile(join(root, files[0]!.path), "utf8")).toBe("inside");
});

it("rolls back a committed file even when its post-commit cleanup reports failure", async () => {
  const persist: typeof safeFileOperation = async (path, operation, signal) => {
    const result = await safeFileOperation(path, operation, signal);
    throw Object.assign(new Error("injected post-commit failure"), { committed: true, result });
  };
  await expect(new UploadManager({}, persist).receive(request([{ name: "a", data: "a" }]), root)).rejects.toMatchObject({ status: 500 });
  expect(await storedEntries(join(root, ".ringko", "uploads"))).toEqual([]);
});

it("limits multipart entries and settles an active body when closing", async () => {
  const manager = new UploadManager({ files: 1 });
  await expect(manager.receive(request([{ name: "a", data: "a" }, { name: "b", data: "b" }]), root)).rejects.toMatchObject({ status: 413 });
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("--fixture\r\n")); } });
  const pending = manager.receive(new Request("http://fixture/api/upload", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=fixture" }, body }), root);
  const observed = pending.catch(error => error);
  expect(manager.busy).toBe(true);
  await manager.close();
  expect(await observed).toMatchObject({ status: 408 });
  expect(manager.busy).toBe(false);
});

it("does not race workspace quota across independently created backend managers", async () => {
  const managers = [new UploadManager({ workspaceBytes: 10 }), new UploadManager({ workspaceBytes: 10 })];
  const results = await Promise.allSettled(managers.map((manager, index) => manager.receive(request([{ name: String(index), data: "123456" }]), root)));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const failed = results.find(result => result.status === "rejected");
  expect(failed?.status === "rejected" && [429, 507].includes(failed.reason.status)).toBe(true);
  expect(await storedEntries(join(root, ".ringko", "uploads"))).toHaveLength(1);
});
