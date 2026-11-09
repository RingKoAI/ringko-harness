import { afterEach, beforeEach, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { safeFileOperation } from "../src/file-operation.ts";

const execute = promisify(execFile);
let root: string;
beforeEach(async () => { root = await realpath(await mkdtemp(join(tmpdir(), "rkh-file-metadata-"))); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it.skipIf(process.platform !== "win32")("preserves Windows hidden/system attributes and creation time", async () => {
  const path = join(root, "attributes.txt"), windows = process.env.SystemRoot ?? "C:\\Windows";
  await writeFile(path, "original");
  await execute(join(windows, "System32", "attrib.exe"), ["+h", "+s", path]);
  const before = await stat(path);
  await safeFileOperation(path, { kind: "edit", oldString: "original", newString: "updated", replaceAll: false });
  const result = await execute(join(windows, "System32", "attrib.exe"), [path]);
  const attributes = result.stdout.split(/\r?\n/)[0]?.split(/[A-Za-z]:/)[0] ?? "";
  expect(attributes).toContain("H"); expect(attributes).toContain("S");
  expect(Math.abs((await stat(path)).birthtimeMs - before.birthtimeMs)).toBeLessThan(1);
  expect(await readFile(path, "utf8")).toBe("updated");
}, 30_000);

const python = Bun.which("python3") ?? Bun.which("python");
it.skipIf(process.platform === "win32" || (process.platform !== "darwin" && !python))("preserves bounded POSIX user attributes during atomic replacement", async () => {
  const path = join(root, "attributes.txt"); await writeFile(path, "original");
  if (process.platform === "darwin") await execute("/usr/bin/xattr", ["-w", "user.rkh_metadata", "preserved", path]);
  else await execute(python!, ["-c", "import os,sys; os.setxattr(sys.argv[1], b'user.rkh_metadata', b'preserved')", path]);
  await safeFileOperation(path, { kind: "edit", oldString: "original", newString: "updated", replaceAll: false });
  const result = process.platform === "darwin"
    ? await execute("/usr/bin/xattr", ["-p", "user.rkh_metadata", path])
    : await execute(python!, ["-c", "import os,sys; print(os.getxattr(sys.argv[1], b'user.rkh_metadata').decode())", path]);
  expect(result.stdout.trim()).toBe("preserved");
  expect(await readFile(path, "utf8")).toBe("updated");
});
