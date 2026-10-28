/** Distance from the tail, in pixels, that still counts as reading the latest message. */
export const CHAT_FOLLOW_THRESHOLD = 24

export interface ScrollMetrics { scrollTop: number; scrollHeight: number; clientHeight: number }

export function scrollMetrics(element: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>): ScrollMetrics {
  return { scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }
}

/** True when the viewport is at (or within the threshold of) the latest content. */
export function isNearBottom(metrics: ScrollMetrics, threshold = CHAT_FOLLOW_THRESHOLD): boolean {
  const remaining = metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight
  // A negative remainder means the content does not overflow the viewport.
  return remaining <= threshold
}

/**
 * Decide whether new content should auto-scroll. A reader who scrolled away from
 * the tail keeps their position until they explicitly return to it.
 */
export function shouldFollowTail(following: boolean, metrics: ScrollMetrics, threshold = CHAT_FOLLOW_THRESHOLD): boolean {
  return following || isNearBottom(metrics, threshold)
}
