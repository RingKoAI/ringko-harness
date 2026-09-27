// Queries over stored sessions (most-recent model, etc.).
import type { SessionStore } from "./store.ts";
import { sessionModel, sessionTitle } from "./transcript.ts";

/** The model recorded by the most recent session, if any. */
export function latestSessionModel(store: SessionStore): string | undefined {
  const [newest] = store.list();
  if (!newest) return undefined;
  try {
    return sessionModel(store.open(newest.id, "read").all());
  } catch {
    return undefined;
  }
}

/** The title recorded by the most recent session, if any. */
export function latestSessionTitle(store: SessionStore): string | undefined {
  const [newest] = store.list();
  if (!newest) return undefined;
  try {
    return sessionTitle(store.open(newest.id, "read").all());
  } catch {
    return undefined;
  }
}
