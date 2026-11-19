/** Distance from the tail, in pixels, that still counts as reading the latest message. */
export const CHAT_FOLLOW_THRESHOLD = 24

/** How long a jump-to-latest animation owns the viewport before pinning resumes. */
export const CHAT_SMOOTH_SCROLL_MS = 500

export interface ScrollMetrics { scrollTop: number; scrollHeight: number; clientHeight: number }

export function scrollMetrics(element: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>): ScrollMetrics {
  return { scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }
}

/**
 * Pixels between the viewport's bottom edge and the end of the content. Content
 * that does not overflow the viewport has no distance left to travel.
 */
export function distanceFromTail(metrics: ScrollMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight)
}

/** True when the viewport is at (or within the threshold of) the latest content. */
export function isNearBottom(metrics: ScrollMetrics, threshold = CHAT_FOLLOW_THRESHOLD): boolean {
  return distanceFromTail(metrics) <= threshold
}

/**
 * Decide whether new content should auto-scroll. A reader who scrolled away from
 * the tail keeps their position until they explicitly return to it.
 */
export function shouldFollowTail(following: boolean, metrics: ScrollMetrics, threshold = CHAT_FOLLOW_THRESHOLD): boolean {
  return following || isNearBottom(metrics, threshold)
}
