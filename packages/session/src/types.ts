// Session storage types (event-sourced, dsh-style).
//
// A session is one append-only log. The header line carries identity/metadata;
// every later line is one event addressed by a monotonic, contiguous `seq`.
// The log is the source of truth; conversation history is derived from it.

/** On-disk format version. Readers reject newer versions (fail closed). */
export const SESSION_FORMAT_VERSION = 1;

/** Header record discriminator. */
export const SESSION_HEADER_TYPE = "session";

export type SessionId = string;

/** First line of a session log. */
export interface SessionHeader {
  /** Stable session id (also the directory name, encoded). */
  id: SessionId;
  /** Format version (see SESSION_FORMAT_VERSION). */
  version: number;
  /** Creation time, Unix epoch milliseconds. */
  createdAt: number;
  /** Working directory the session belongs to. */
  cwd?: string;
  /** Parent session id for forks/subagents. */
  parentSession?: SessionId;
  /** Free-form metadata. */
  attributes?: Record<string, unknown>;
}

/** One event line. `seq` is assigned by the store and never rewritten. */
export interface SessionEvent {
  type: string;
  seq: number;
  time: number;
  data?: unknown;
  /**
   * When true, a reader that does not understand `type` may skip it. Absent or
   * false means the event is required and an unknown type must be rejected.
   */
  ignorable?: boolean;
}

/** An event to append before `seq`/`time` are assigned. */
export interface SessionEventInput {
  type: string;
  data?: unknown;
  time?: number;
  ignorable?: boolean;
}

export type SessionOpenMode = "read" | "write";

/** Lightweight metadata for listing, read from the header only. */
export interface SessionMeta {
  id: SessionId;
  header: SessionHeader;
  /** Absolute path of the session directory. */
  dir: string;
  /** Absolute path of the current log file. */
  path: string;
  sizeBytes: number;
}
