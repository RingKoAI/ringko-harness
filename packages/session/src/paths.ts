// Session storage locations.
//
// Layout under the session root (default `~/.ringko/sessions`):
//   <root>/--<normalized-cwd>--/<encoded-id>/session.jsonl
// The per-project directory keeps sessions scannable per workspace; the session
// id is encoded so it can never escape its directory.
import { join } from "node:path";
import { ringkoRoot } from "@ringko-ai/config";

export const SESSIONS_DIR_NAME = "sessions";
export const SESSION_LOG_NAME = "session.jsonl";
export const SESSION_LOCK_NAME = "session.lock";
export const NO_CWD_DIR_NAME = "_no-cwd";

/** The session root (default `~/.ringko/sessions`). */
export function sessionsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(ringkoRoot(env), SESSIONS_DIR_NAME);
}

/** Human-readable, filesystem-safe directory name for a working directory. */
export function projectDirName(cwd: string | undefined): string {
  if (!cwd || cwd.trim().length === 0) return NO_CWD_DIR_NAME;
  const normalized = cwd
    .replace(/\\/g, "/")
    .replace(/^([A-Za-z]):/, "$1")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  return `--${normalized.replace(/\/+/g, "-")}--`;
}

const SAFE_SEGMENT = /^[A-Za-z0-9._-]$/;

/** Injective encoding of a session id into a single path segment. */
export function encodeSegment(id: string): string {
  if (id.length === 0) throw new TypeError("Session id must not be empty.");
  let out = "";
  for (const char of id) {
    if (SAFE_SEGMENT.test(char)) {
      out += char;
    } else {
      out += `~${char.codePointAt(0)!.toString(16).padStart(4, "0")}`;
    }
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
