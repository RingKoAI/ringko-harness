// Cross-process single-writer lock for a session directory.
//
// Implemented with an exclusive-create lock file holding the owner pid. A lock
// left behind by a dead process is treated as stale and reclaimed; a live owner
// rejects the second writer.
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";

export interface SessionLock {
  release(): void;
}

function readOwnerPid(path: string): number | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed === "object" && parsed !== null && typeof (parsed as { pid?: unknown }).pid === "number") {
      return (parsed as { pid: number }).pid;
    }
  } catch {
    // unreadable/corrupt lock: treat as unknown owner
  }
  return undefined;
}

function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH = no such process; EPERM = exists but not ours → still alive.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Acquire the lock at `path`, or throw if a live writer already holds it. */
export function acquireLock(path: string): SessionLock {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, JSON.stringify({ pid: process.pid, time: Date.now() }));
      closeSync(fd);
      return {
        release() {
          try {
            unlinkSync(path);
          } catch {
            // already gone
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = readOwnerPid(path);
      if (owner !== undefined && !isAlive(owner)) {
        try {
          unlinkSync(path);
        } catch {
          // raced with another reclaimer; retry
        }
        continue;
      }
      throw new Error(`Session is locked by another writer (${path}).`);
    }
  }
  throw new Error(`Could not acquire session lock (${path}).`);
}
