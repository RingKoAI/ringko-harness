/** One message the quick-jump rail can reach. */
export interface QuickJumpItem {
  /** Identity of the message, used to build its DOM anchor id. */
  id: string
  role: 'user' | 'assistant' | 'tool'
  /** Short excerpt shown in the hover preview. */
  preview?: string
}

/** Longest rail that stays readable; beyond this the rail stops being a shortcut. */
export const QUICK_JUMP_MAX_ITEMS = 128

/** Longest preview kept for a rail tooltip. */
export const QUICK_JUMP_PREVIEW_LENGTH = 120

/** Tallest rail the density buckets aim for, in pixels. */
export const QUICK_JUMP_RAIL_HEIGHT = 520

/**
 * Tick bar height and gap for a transcript of this length. Fixed sizes overflow
 * the viewport once a conversation has many messages, so the rail thins out as
 * it grows and still ends up shorter than {@link QUICK_JUMP_RAIL_HEIGHT}.
 * @param count - number of ticks the rail holds.
 * @returns bar height and gap in pixels.
 */
export function quickJumpDensity(count: number): { bar: number; gap: number } {
  const buckets = [
    { max: 24, bar: 6, gap: 4 },
    { max: 48, bar: 5, gap: 3 },
    { max: 80, bar: 4, gap: 2 },
    { max: 104, bar: 4, gap: 1 },
    { max: QUICK_JUMP_MAX_ITEMS, bar: 3, gap: 1 },
  ]
  const bucket = buckets.find(candidate => count <= candidate.max) ?? buckets[buckets.length - 1]!
  return { bar: bucket.bar, gap: bucket.gap }
}

/** DOM id of one message anchor. */
export function quickJumpAnchorId(id: string): string {
  return `chat-message-${id}`
}

/** Whether a transcript of this length is worth a rail. */
export function canQuickJump(count: number): boolean {
  return count > 1 && count <= QUICK_JUMP_MAX_ITEMS
}

/** Collapse a message into a single-line preview for the rail tooltip. */
export function quickJumpPreview(text: string, limit = QUICK_JUMP_PREVIEW_LENGTH): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= limit) return flat
  return `${flat.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

/**
 * Pick the message the reader is looking at: the last anchor whose top edge has
 * already passed the reading line, falling back to `fallback` when nothing has.
 * @param anchors - anchor tops in transcript order.
 * @param line - vertical reading line in viewport coordinates.
 * @param fallback - index used when no anchor has passed the line yet.
 * @returns the zero-based index of the active message.
 */
export function resolveQuickJumpIndex(
  anchors: readonly { top: number }[],
  line: number,
  fallback = 0,
): number {
  let active = fallback
  for (const [index, anchor] of anchors.entries()) {
    if (anchor.top > line) break
    active = index
  }
  return active
}
