import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, linkSync, mkdirSync, openSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, lstatSync } from "node:fs";
import { dirname } from "node:path";

function stageJson(path: string, value: object): string {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    try {
      writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      fsyncSync(descriptor);
    } finally { closeSync(descriptor); }
  } catch (error) { rmSync(temporary, { force: true }); throw error; }
  return temporary;
}

export function assertConfigTarget(path: string): boolean {
  try {
    lstatSync(path);
    if (!statSync(path).isFile()) throw new Error("Configuration target must be a regular file.");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // An existing dangling link is externally managed, not a missing config to regenerate.
      try { lstatSync(path); } catch (missing) { if ((missing as NodeJS.ErrnoException).code === "ENOENT") return false; throw missing; }
      throw new Error("Configuration target is a broken symbolic link.");
    }
    throw error;
  }
}

/** Publish a complete inode exclusively: concurrent startup never replaces a winner. */
export function createJsonIfMissing(path: string, value: object): boolean {
  if (assertConfigTarget(path)) return false;
  const temporary = stageJson(path, value);
  try {
    try { linkSync(temporary, path); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST" && assertConfigTarget(path)) return false; throw error; }
  } finally { rmSync(temporary, { force: true }); }
}

export function replaceJson(path: string, value: object): string {
  const target = assertConfigTarget(path) ? realpathSync(path) : path;
  const temporary = stageJson(target, value);
  try { renameSync(temporary, target); } finally { rmSync(temporary, { force: true }); }
  return path;
}
