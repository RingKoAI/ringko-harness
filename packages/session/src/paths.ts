// Session storage locations.
//
// Layout under the session root (default `~/.ringko/sessions`):
//   <root>/--<workspace-key>--/<encoded-id>/session.jsonl
// The per-project directory keeps sessions scannable per workspace; the session
// id is encoded so it can never escape its directory.
import { join } from "node:path";
import { backendKey, ringkoRoot } from "@ringko-ai/config";

export const SESSIONS_DIR_NAME = "sessions";
export const SESSION_LOG_NAME = "session.jsonl";
export const SESSION_LOCK_NAME = "session.lock";
export const NO_CWD_DIR_NAME = "_no-cwd";

/** The session root (default `~/.ringko/sessions`). */
export function sessionsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(ringkoRoot(env), SESSIONS_DIR_NAME);
}

/** Previous layout, retained for discovery of existing logs. */
export function legacyProjectDirName(cwd: string | undefined): string {
  if (!cwd || cwd.trim().length === 0) return NO_CWD_DIR_NAME;
  const normalized = cwd
    .replace(/\\/g, "/")
    .replace(/^([A-Za-z]):/, "$1")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  return `--${normalized.replace(/\/+/g, "-")}--`;
}

/** Collision-resistant workspace identity; old human-readable folders remain readable. */
export function projectDirName(cwd: string | undefined): string {
  return !cwd || !cwd.trim() ? NO_CWD_DIR_NAME : `--${backendKey(cwd)}--`;
}

export function projectDirNames(cwd: string | undefined): string[] {
  return [...new Set([projectDirName(cwd), legacyProjectDirName(cwd)])];
}

const SAFE_SEGMENT = /^[a-z0-9_-]$/;
const MAX_SEGMENT_CHARACTERS = 255;

/** Injective encoding of a session id into a single path segment. */
export function encodeSegment(id: string): string {
  if (typeof id !== "string" || id.length === 0) throw new TypeError("Session id must not be empty.");
  // A prefix avoids Windows device names; fixed-width UTF-16 escapes also
  // distinguish case on case-insensitive filesystems and preserve lone surrogates.
  let out = "s-";
  for (let index = 0; index < id.length; index++) {
    const char = id[index]!;
    if (SAFE_SEGMENT.test(char)) {
      out += char;
    } else {
      out += `~${id.charCodeAt(index).toString(16).padStart(4, "0")}`;
    }
    if (out.length > MAX_SEGMENT_CHARACTERS) throw new TypeError("Encoded session id exceeds the filesystem segment limit.");
  }
  return out;
}

/** The directory owned by a session. */
export function sessionDir(root: string, cwd: string | undefined, id: string): string {
  return join(root, projectDirName(cwd), encodeSegment(id));
}

/** The current (generation 0) log file inside a session directory. */
export function sessionLogPath(dir: string): string {
  return join(dir, SESSION_LOG_NAME);
}

/** The cross-process write lock inside a session directory. */
export function sessionLockPath(dir: string): string {
  return join(dir, SESSION_LOCK_NAME);
}
