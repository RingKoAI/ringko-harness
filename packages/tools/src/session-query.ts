// Read-only queries over recorded sessions (workspace-scoped).
//
// Every tool here reads only the session logs of the workspace it was
// registered for. `SessionStore.list()` is working-directory scoped, and an
// explicit session id is only accepted when it appears in that scoped list, so
// a log from another project cannot be opened by guessing an id. Nothing in
// this module writes, flushes or locks a session: handles open in "read" mode.
//
// Risk is assessed as `workspace_file` rather than `external_file` on purpose:
// the logs live under the user's RingKo home, but they are the history of the
// workspace itself, so the default mode allows reading them like any other
// workspace file. A permission rule can still deny by target (`session:<id>`).
import { resolve } from "node:path";
import { defineTool, type ToolDefinition, type ToolRegistry } from "@ringko-ai/harness";
import { SessionStore, sessionTitle, type SessionEvent } from "@ringko-ai/session";

export interface SessionQueryLimits {
  /** Sessions listed by `session_list` or scanned by `session_search`. */
  sessions: number;
  /** Events returned by one `session_read` call. */
  events: number;
  /** A session log larger than this is not parsed at all. */
  sessionBytes: number;
  /** Logs larger than this are listed without deriving a title. */
  titleBytes: number;
  /** Total log bytes a single search may parse. */
  scanBytes: number;
  /** Serialized event data retained per event. */
  eventCharacters: number;
  /** One search snippet. */
  snippetCharacters: number;
  /** Accepted `query` length. */
  queryCharacters: number;
  /** Total characters any single call may return. */
  responseCharacters: number;
  /** Events examined per session during a search. */
  scanEventsPerSession: number;
}

export const SESSION_QUERY_LIMITS: Readonly<SessionQueryLimits> = Object.freeze({
  /** Sessions listed by `session_list` or scanned by `session_search`. */
  sessions: 50,
  /** Events returned by one `session_read` call. */
  events: 100,
  /** A session log larger than this is not parsed at all. */
  sessionBytes: 4 * 1024 * 1024,
  /** Logs larger than this are listed without deriving a title. */
  titleBytes: 256 * 1024,
  /** Total log bytes a single search may parse. */
  scanBytes: 32 * 1024 * 1024,
  /** Serialized event data retained per event. */
  eventCharacters: 4_096,
  /** One search snippet. */
  snippetCharacters: 240,
  /** Accepted `query` length. */
  queryCharacters: 200,
  /** Total characters any single call may return. */
  responseCharacters: 60_000,
  /** Events examined per session during a search. */
  scanEventsPerSession: 20_000,
});

export interface SessionQueryOptions {
  /** Workspace whose sessions are exposed; also the store's `cwd`. */
  workspace: string;
  /** Share an existing store; defaults to a new store scoped to `workspace`. */
  store?: SessionStore;
  /** Overrides for {@link SESSION_QUERY_LIMITS}, mainly for tests. */
  limits?: Partial<SessionQueryLimits>;
}

export interface SessionSummary {
  id: string;
  title?: string;
  createdAt: number;
  sizeBytes: number;
  parentSession?: string;
}

export interface SessionListOutput {
  workspace: string;
  sessions: SessionSummary[];
  truncated: boolean;
}

export interface SessionSearchMatch {
  session: string;
  seq: number;
  time: number;
  type: string;
  snippet: string;
}

export interface SessionSearchOutput {
  query: string;
  matches: SessionSearchMatch[];
  scanned: { sessions: number; events: number };
  truncated: boolean;
}

export interface SessionEventRecord {
  seq: number;
  time: number;
  type: string;
  /** Present when the recorded data fits the per-event character budget. */
  data?: unknown;
  /** Serialized data, present instead of `data` when the event is too large. */
  dataText?: string;
  dataTruncated: boolean;
}

export interface SessionReadOutput {
  session: SessionSummary;
  events: SessionEventRecord[];
  hasOlder: boolean;
  hasNewer: boolean;
  truncated: boolean;
}

type Limits = Readonly<SessionQueryLimits>;

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected an object input.");
  }
  return value as Record<string, unknown>;
}

function integerField(record: Record<string, unknown>, key: string, min: number, max: number): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`Invalid '${key}'; expected an integer between ${min} and ${max}.`);
  }
  return value;
}

function stringField(record: Record<string, unknown>, key: string, max: number): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    throw new TypeError(`Invalid '${key}'; expected a non-empty string of at most ${max} characters.`);
  }
  return value;
}

/** Case-insensitive on Windows, where the same directory has many spellings. */
function normalizePath(path: string): string {
  const resolved = resolve(path);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function inWorkspace(cwd: string | undefined, workspace: string): boolean {
  return typeof cwd === "string" && cwd.length > 0 && normalizePath(cwd) === normalizePath(workspace);
}

function serialize(value: unknown): string {
  if (value === undefined) return "";
  try {
    return typeof value === "string" ? value : JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function snippetOf(text: string, needle: string, limit: number): string {
  const folded = text.toLowerCase();
  const at = folded.indexOf(needle);
  if (at < 0) return collapse(text).slice(0, limit);
  const start = Math.max(0, at - Math.floor((limit - needle.length) / 2));
  const window = collapse(text.slice(start, start + limit * 2));
  return window.length > limit ? `${window.slice(0, limit)}…` : window;
}

function titleFor(handle: { all(): readonly SessionEvent[] }): string | undefined {
  try {
    return sessionTitle(handle.all());
  } catch {
    return undefined;
  }
}

interface ScopedSession {
  summary: SessionSummary;
  events: readonly SessionEvent[];
}

/** Resolve one session id inside the registered workspace, or throw. */
function openScoped(store: SessionStore, workspace: string, id: string, limits: Limits): ScopedSession {
  const meta = store.list().find(candidate => candidate.id === id);
  if (!meta) throw new Error(`No session "${id}" in this workspace.`);
  if (meta.sizeBytes > limits.sessionBytes) {
    throw new Error(`Session "${id}" is too large to read (${meta.sizeBytes} bytes; limit ${limits.sessionBytes}).`);
  }
  const handle = store.open(meta.id, "read");
  try {
    // list() is directory-scoped; re-check the recorded cwd so a moved or
    // copied log cannot be addressed from the wrong workspace. Defense in depth.
    if (!inWorkspace(handle.header.cwd, workspace)) {
      throw new Error(`Session "${id}" belongs to another workspace.`);
    }
    const title = titleFor(handle);
    return {
      summary: {
        id: handle.header.id,
        ...(title ? { title } : {}),
        createdAt: handle.header.createdAt,
        sizeBytes: meta.sizeBytes,
        ...(handle.header.parentSession ? { parentSession: handle.header.parentSession } : {}),
      },
      events: handle.all(),
    };
  } finally {
    handle.close();
  }
}

function summaryFor(meta: { id: string; header: { createdAt: number; cwd?: string; parentSession?: string }; sizeBytes: number }, store: SessionStore, limits: Limits): SessionSummary {
  const base: SessionSummary = {
    id: meta.id,
    createdAt: meta.header.createdAt,
    sizeBytes: meta.sizeBytes,
    ...(meta.header.parentSession ? { parentSession: meta.header.parentSession } : {}),
  };
  if (meta.sizeBytes > limits.titleBytes) return base;
  try {
    const handle = store.open(meta.id, "read");
    try {
      const title = titleFor(handle);
      return title ? { ...base, title } : base;
    } finally {
      handle.close();
    }
  } catch {
    return base;
  }
}

export function createSessionListTool(store: SessionStore, workspace: string, limits: Limits = SESSION_QUERY_LIMITS): ToolDefinition<{ limit?: number }, SessionListOutput> {
  return defineTool<{ limit?: number }, SessionListOutput>({
    name: "session_list",
    taskAccess: "read",
    description: "List the recorded sessions of the current workspace, newest first, with id, title, creation time and size. Use the id with session_read or session_search.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: limits.sessions } },
      additionalProperties: false,
    },
    parseInput(value) {
      if (value === undefined || value === null) return {};
      const record = asRecord(value);
      const limit = integerField(record, "limit", 1, limits.sessions);
      return limit === undefined ? {} : { limit };
    },
    assessRisk() {
      return { kind: "workspace_file", reason: "List recorded sessions for this workspace.", target: "session:list" };
    },
    execute({ limit }) {
      // Defense in depth: list() is directory-scoped, but a log copied into this
      // workspace's project directory can still record another cwd.
      const all = store.list().filter(meta => inWorkspace(meta.header.cwd, workspace));
      const selected = all.slice(0, limit ?? limits.sessions);
      return {
        workspace,
        sessions: selected.map(meta => summaryFor(meta, store, limits)),
        truncated: all.length > selected.length,
      };
    },
  });
}

export function createSessionSearchTool(store: SessionStore, workspace: string, limits: Limits = SESSION_QUERY_LIMITS): ToolDefinition<{ query: string; session?: string }, SessionSearchOutput> {
  return defineTool<{ query: string; session?: string }, SessionSearchOutput>({
    name: "session_search",
    taskAccess: "read",
    description: "Search recorded session events in this workspace for a case-insensitive substring. Returns the session id, sequence number, event type and a short snippet for each match; follow up with session_read.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: limits.queryCharacters },
        session: { type: "string" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    parseInput(value) {
      const record = asRecord(value);
      const query = stringField(record, "query", limits.queryCharacters);
      if (query === undefined) throw new TypeError("Expected a non-empty string 'query'.");
      const session = stringField(record, "session", 256);
      return session === undefined ? { query } : { query, session };
    },
    assessRisk(input) {
      const target = input.session ? `session:${input.session}` : "session:search";
      return { kind: "workspace_file", reason: "Search recorded session events for this workspace.", target };
    },
    execute({ query, session }) {
      const needle = query.toLowerCase();
      const all = store.list().filter(meta => inWorkspace(meta.header.cwd, workspace));
      const targets = session ? all.filter(meta => meta.id === session) : all.slice(0, limits.sessions);
      if (session !== undefined && targets.length === 0) throw new Error(`No session "${session}" in this workspace.`);
      const matches: SessionSearchMatch[] = [];
      const scanned = { sessions: 0, events: 0 };
      let characters = 0;
      let bytes = 0;
      let truncated = false;
      for (const meta of targets) {
        if (matches.length >= limits.events || characters >= limits.responseCharacters) { truncated = true; break; }
        // Bound the total parsing cost, not just the number of sessions.
        if (bytes + meta.sizeBytes > limits.scanBytes) { truncated = true; break; }
        let scoped: ScopedSession;
        try {
          scoped = openScoped(store, workspace, meta.id, limits);
        } catch {
          continue;
        }
        bytes += meta.sizeBytes;
        scanned.sessions += 1;
        for (const event of scoped.events.slice(0, limits.scanEventsPerSession)) {
          if (matches.length >= limits.events || characters >= limits.responseCharacters) { truncated = true; break; }
          scanned.events += 1;
          const haystack = `${event.type} ${serialize(event.data)}`;
          if (!haystack.toLowerCase().includes(needle)) continue;
          const snippet = snippetOf(haystack, needle, limits.snippetCharacters);
          matches.push({ session: meta.id, seq: event.seq, time: event.time, type: event.type, snippet });
          characters += snippet.length + 64;
        }
      }
      return { query, matches, scanned, truncated };
    },
  });
}

export function createSessionReadTool(store: SessionStore, workspace: string, limits: Limits = SESSION_QUERY_LIMITS): ToolDefinition<{ session: string; before?: number; after?: number; limit?: number }, SessionReadOutput> {
  return defineTool<{ session: string; before?: number; after?: number; limit?: number }, SessionReadOutput>({
    name: "session_read",
    taskAccess: "read",
    description: "Read recorded events from one session of this workspace by sequence cursor. Returns seq, time, type and data; oversized data is returned as bounded text.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string" },
        before: { type: "integer", minimum: 0 },
        after: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1, maximum: limits.events },
      },
      required: ["session"],
      additionalProperties: false,
    },
    parseInput(value) {
      const record = asRecord(value);
      const session = stringField(record, "session", 256);
      if (session === undefined) throw new TypeError("Expected a non-empty string 'session'.");
      const before = integerField(record, "before", 0, Number.MAX_SAFE_INTEGER);
      const after = integerField(record, "after", 0, Number.MAX_SAFE_INTEGER);
      if (before !== undefined && after !== undefined) throw new TypeError("Pass either 'before' or 'after', not both.");
      const limit = integerField(record, "limit", 1, limits.events);
      return { session, ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}), ...(limit !== undefined ? { limit } : {}) };
    },
    assessRisk(input) {
      return { kind: "workspace_file", reason: "Read recorded events from a session of this workspace.", target: `session:${input.session}` };
    },
    execute({ session, before, after, limit }) {
      const scoped = openScoped(store, workspace, session, limits);
      const candidates = scoped.events.filter(event => before !== undefined ? event.seq < before
        : after !== undefined ? event.seq > after : true);
      const selected = after !== undefined ? candidates.slice(0, limit ?? limits.events) : candidates.slice(-(limit ?? limits.events));
      const records: SessionEventRecord[] = [];
      let characters = 0;
      let truncated = false;
      for (const event of selected) {
        const text = serialize(event.data);
        const tooLarge = text.length > limits.eventCharacters;
        if (characters + Math.min(text.length, limits.eventCharacters) > limits.responseCharacters) { truncated = true; break; }
        characters += Math.min(text.length, limits.eventCharacters) + 64;
        records.push({
          seq: event.seq,
          time: event.time,
          type: event.type,
          ...(tooLarge ? { dataText: `${text.slice(0, limits.eventCharacters)}…` } : event.data !== undefined ? { data: event.data } : {}),
          dataTruncated: tooLarge,
        });
      }
      const first = selected[0];
      const last = selected[selected.length - 1];
      return {
        session: scoped.summary,
        events: records,
        hasOlder: first !== undefined && candidates.some(event => event.seq < first.seq),
        hasNewer: last !== undefined && candidates.some(event => event.seq > last.seq),
        truncated: truncated || records.length < selected.length,
      };
    },
  });
}

/**
 * Register the read-only session history tools (`session_list`,
 * `session_search`, `session_read`). Sessions are scoped to `workspace`;
 * the tools never write to a session.
 */
export function registerSessionQueryTools(registry: ToolRegistry, options: SessionQueryOptions): void {
  if (typeof options.workspace !== "string" || options.workspace.trim().length === 0) {
    throw new TypeError("Session query tools require a workspace.");
  }
  const limits: Limits = { ...SESSION_QUERY_LIMITS, ...options.limits };
  const store = options.store ?? new SessionStore({ cwd: options.workspace });
  registry.registerAll([
    createSessionListTool(store, options.workspace, limits),
    createSessionSearchTool(store, options.workspace, limits),
    createSessionReadTool(store, options.workspace, limits),
  ]);
}
