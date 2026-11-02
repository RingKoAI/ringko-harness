// Branch a session: copy an event prefix into a new child session.
import type { SessionStore } from "./store.ts";
import type { SessionEvent } from "./types.ts";

/** The transcript message at `index` (compaction resets the index), if present. */
function messageEventAt(events: readonly SessionEvent[], index: number): SessionEvent | undefined {
  let seen = -1;
  for (const event of events) {
    if (event.type === "session/compaction") { seen = -1; continue; }
    if (event.type !== "user/message" && event.type !== "assistant/message" && event.type !== "tool/result") continue;
    seen += 1;
    if (seen === index) return event;
  }
  return undefined;
}

/** The seq of the transcript message at `index`, or the last event when out of range. */
export function messageSeqAt(events: readonly SessionEvent[], index: number): number {
  return messageEventAt(events, index)?.seq ?? events.at(-1)?.seq ?? -1;
}

export interface ForkSessionOptions {
  /** Working directory for the child; defaults to the store's cwd. */
  cwd?: string;
  /** Transcript message index to branch at; omitted branches the whole session. */
  index?: number;
  /**
   * Copy only the events before the target message. Used to rewrite a user
   * prompt: the caller then sends the edited content into the child.
   */
  before?: boolean;
}

/**
 * Copy a session's event prefix into a new child session and return the child id.
 * Throws for an unknown session or an empty log so callers can map the failure.
 */
export function forkSession(store: SessionStore, id: string, options: ForkSessionOptions = {}): string {
  const source = store.open(id, "read");
  const events = source.all();
  if (events.length === 0) throw new Error("Nothing to branch.");
  const index = typeof options.index === "number" && Number.isInteger(options.index) && options.index >= 0
    ? options.index
    : Number.MAX_SAFE_INTEGER;
  const target = options.before ? messageEventAt(events, index) : undefined;
  if (options.before && target?.type !== "user/message") {
    throw new Error("Edit target must be a user message.");
  }
  const cutoff = target?.seq ?? messageSeqAt(events, index);
  const child = store.create({ cwd: options.cwd, parentSession: id });
  try {
    child.append(
      events
        .filter(event => options.before ? event.seq < cutoff : event.seq <= cutoff)
        .map(event => ({ type: event.type, ...(event.data !== undefined ? { data: event.data } : {}), time: event.time })),
    );
    child.flush();
  } finally {
    child.close();
  }
  return child.id;
}
