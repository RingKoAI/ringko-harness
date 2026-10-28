export const SIDEBAR_WIDTH_KEY = 'ringko.sidebar-width'
export const SIDEBAR_WIDTH_DEFAULT = 256
export const SIDEBAR_WIDTH_MIN = 208
export const SIDEBAR_WIDTH_MAX = 360

/** Clamp a requested sidebar width to the supported range. */
export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDEBAR_WIDTH_DEFAULT
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(value)))
}

type ReadStorage = { getItem(key: string): string | null }

/** Read the persisted width, falling back to the default when storage is missing or invalid. */
export function readSidebarWidth(storage?: ReadStorage): number {
  try {
    const raw = storage?.getItem(SIDEBAR_WIDTH_KEY)
    return raw === null || raw === undefined ? SIDEBAR_WIDTH_DEFAULT : clampSidebarWidth(Number(raw))
  } catch {
    return SIDEBAR_WIDTH_DEFAULT
  }
}

interface SearchableSession { id: string; title?: string | null; summary?: string | null }

/** Case-insensitive match over a session's title, summary and id. */
export function filterSessions<T extends SearchableSession>(sessions: readonly T[], query: string): readonly T[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return sessions
  return sessions.filter(session => `${session.title ?? ''}\n${session.summary ?? ''}\n${session.id}`.toLowerCase().includes(needle))
}
