// Event-sourced session store (dsh-style).
//
// A session is created lazily (nothing is written until the first append/flush),
// owned by a single writer while open, and materialized atomically. Reads parse
// the whole log; the store never rewrites committed events.
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { parseHeaderOnly, parseLog } from "./format.ts";
import { serializeEvent, serializeHeader } from "./format.ts";
import { acquireLock, type SessionLock } from "./lock.ts";
import {
  NO_CWD_DIR_NAME,
  projectDirName,
  sessionDir,
  sessionLockPath,
  sessionLogPath,
  SESSION_LOG_NAME,
  sessionsRoot,
} from "./paths.ts";
import {
  SESSION_FORMAT_VERSION,
  type SessionEvent,
  type SessionEventInput,
  type SessionHeader,
  type SessionMeta,
  type SessionOpenMode,
} from "./types.ts";

export interface SessionStoreOptions {
  /** Session root; defaults to `~/.ringko/sessions`. */
  root?: string;
  /** Default working directory for created sessions. */
  cwd?: string;
  /** Environment used to resolve the default root. */
  env?: NodeJS.ProcessEnv;
}

export interface CreateSessionOptions {
  id?: string;
  cwd?: string;
  parentSession?: string;
  attributes?: Record<string, unknown>;
  now?: number;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function defaultId(now = Date.now()): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `session-${now.toString(36)}-${rand}`;
}

export class SessionStore {
  readonly root: string;
  readonly cwd?: string;

  constructor(options: SessionStoreOptions = {}) {
    this.root = options.root ?? sessionsRoot(options.env);
    this.cwd = options.cwd;
  }

  /** Create a new (not yet materialized) session with a write handle. */
  create(options: CreateSessionOptions = {}): SessionHandle {
    const cwd = options.cwd ?? this.cwd;
    const id = options.id ?? defaultId(options.now);
    const header: SessionHeader = {
      id,
      version: SESSION_FORMAT_VERSION,
      createdAt: options.now ?? Date.now(),
      ...(cwd ? { cwd } : {}),
      ...(options.parentSession ? { parentSession: options.parentSession } : {}),
      ...(options.attributes ? { attributes: options.attributes } : {}),
    };
    return SessionHandle.create(this, header);
  }

  /** Open an existing session by id. */
  open(id: string, mode: SessionOpenMode = "read"): SessionHandle {
    const dir = this.findDir(id);
    if (!dir) throw new Error(`No session with id "${id}".`);
    const path = sessionLogPath(dir);
    const { header, events } = parseLog(readFileSync(path, "utf8"));
    return SessionHandle.open(this, header, dir, path, events, mode);
  }

  /** Absolute directory of a session, if it exists. */
  findDir(id: string): string | undefined {
    for (const dir of this.sessionDirs()) {
      try {
        const header = parseHeaderOnly(readFileSync(sessionLogPath(dir), "utf8"));
        if (header?.id === id) return dir;
      } catch {
        // skip unreadable logs
      }
    }
    return undefined;
  }

  /** Delete a session's directory. Returns false when the id is unknown. */
  delete(id: string): boolean {
    const dir = this.findDir(id);
    if (!dir) return false;
    rmSync(dir, { recursive: true, force: true });
    return true;
  }

  /** List every session (header only). */
  list(): SessionMeta[] {
    const metas: SessionMeta[] = [];
    for (const dir of this.sessionDirs()) {
      const path = sessionLogPath(dir);
      try {
        const text = readFileSync(path, "utf8");
        const header = parseHeaderOnly(text);
        if (!header) continue;
        metas.push({ id: header.id, header, dir, path, sizeBytes: statSync(path).size });
      } catch {
        // skip unreadable logs
      }
    }
    return metas.sort((a, b) => b.header.createdAt - a.header.createdAt);
  }

  private sessionDirs(): string[] {
    const dirs: string[] = [];
    let projects: string[];
    try {
      projects = readdirSync(this.root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return dirs;
    }
    // A cwd-scoped store only lists the sessions grouped under its workspace.
    const target = this.cwd !== undefined ? projectDirName(this.cwd) : undefined;
    for (const project of projects) {
      if (!project.startsWith("--") && project !== NO_CWD_DIR_NAME) continue;
      if (target !== undefined && project !== target) continue;
      const base = join(this.root, project);
      let sessions: string[];
      try {
        sessions = readdirSync(base, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name);
      } catch {
        continue;
      }
      for (const session of sessions) {
        const dir = join(base, session);
        if (isDirectory(dir) && fileExists(join(dir, SESSION_LOG_NAME))) {
          dirs.push(dir);
        }
      }
    }
    return dirs;
  }
}

function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export class SessionHandle {
  readonly id: string;
  readonly header: SessionHeader;

  private readonly store: SessionStore;
  private readonly mode: SessionOpenMode;
  private readonly events: SessionEvent[];
  private readonly buffer: string[] = [];
  private dir: string;
  private path: string;
  private fd: number | undefined;
  private lock: SessionLock | undefined;
  private materialized: boolean;
  private seq: number;
  private closed = false;

  private constructor(
    store: SessionStore,
    header: SessionHeader,
    dir: string,
    path: string,
    events: SessionEvent[],
    mode: SessionOpenMode,
    materialized: boolean,
  ) {
    this.store = store;
    this.header = header;
    this.id = header.id;
    this.dir = dir;
    this.path = path;
    this.events = events;
    this.seq = events.length;
    this.mode = mode;
    this.materialized = materialized;
    // An existing session opened for writing claims its lock immediately;
    // a freshly created session stays lazy until the first flush.
    if (mode === "write" && materialized) this.claimWrite();
  }

  static create(store: SessionStore, header: SessionHeader): SessionHandle {
    const dir = sessionDir(store.root, header.cwd, header.id);
    return new SessionHandle(store, header, dir, sessionLogPath(dir), [], "write", false);
  }

  static open(
    store: SessionStore,
    header: SessionHeader,
    dir: string,
    path: string,
    events: SessionEvent[],
    mode: SessionOpenMode,
  ): SessionHandle {
    return new SessionHandle(store, header, dir, path, events, mode, true);
  }

  private claimWrite(): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.lock = acquireLock(sessionLockPath(this.dir));
    this.fd = openSync(this.path, "a");
    // An existing-but-empty log (interrupted first write) still needs a header.
    if (!fileExists(this.path) || statSync(this.path).size === 0) {
      writeSync(this.fd, serializeHeader(this.header));
      fsyncSync(this.fd);
    }
  }

  /** Append events; `seq` and `time` are assigned here. Returns the events. */
  append(inputs: readonly SessionEventInput[]): SessionEvent[] {
    this.assertOpen();
    if (this.mode !== "write") throw new Error("Session handle is read-only.");
    const appended: SessionEvent[] = [];
    for (const input of inputs) {
      if (typeof input.type !== "string" || input.type.length === 0) {
        throw new TypeError("Session event type must be a non-empty string.");
      }
      const event: SessionEvent = {
        type: input.type,
        seq: this.seq,
        time: input.time ?? Date.now(),
        ...(input.data !== undefined ? { data: input.data } : {}),
        ...(input.ignorable ? { ignorable: true } : {}),
      };
      this.seq += 1;
      this.events.push(event);
      this.buffer.push(serializeEvent(event));
      appended.push(event);
    }
    return appended;
  }

  /** Convenience for a single event. */
  appendEvent(type: string, data?: unknown, options: { time?: number; ignorable?: boolean } = {}): SessionEvent {
    return this.append([{ type, ...(data !== undefined ? { data } : {}), ...options }])[0];
  }

  /** Materialize (if needed) and durably write buffered events. */
  flush(): void {
    this.assertOpen();
    if (this.mode !== "write") return;
    if (this.buffer.length === 0 && this.materialized) return;

    if (!this.materialized) {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      this.lock = acquireLock(sessionLockPath(this.dir));
      this.fd = openSync(this.path, "a");
      writeSync(this.fd, serializeHeader(this.header));
      this.materialized = true;
    }
    if (this.fd === undefined) this.fd = openSync(this.path, "a");

    for (const line of this.buffer) writeSync(this.fd, line);
    this.buffer.length = 0;
    fsyncSync(this.fd);
  }

  /** All events seen so far (persisted plus appended). */
  all(): readonly SessionEvent[] {
    return this.events;
  }

  /** Close the handle, flushing and releasing the write lock. */
  close(): void {
    if (this.closed) return;
    if (this.mode === "write") this.flush();
    if (this.fd !== undefined) {
      closeSync(this.fd);
      this.fd = undefined;
    }
    this.lock?.release();
    this.lock = undefined;
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Session handle is closed.");
  }
}
