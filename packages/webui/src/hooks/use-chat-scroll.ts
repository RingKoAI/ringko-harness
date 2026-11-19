import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { CHAT_SMOOTH_SCROLL_MS, isNearBottom, scrollMetrics, shouldFollowTail } from '@/lib/chat-scroll'

const VIEWPORT_SELECTOR = '[data-slot="scroll-area-viewport"]'
const TRANSCRIPT_SELECTOR = '[data-chat-transcript]'

export interface ChatScrollOptions {
  /** True while the transcript is mounted. Mounting re-attaches the viewport and follows the tail. */
  active: boolean
  /** Re-attach and return to the tail whenever this changes (session switch). */
  resetKey: string | null
}

export interface ChatScroll {
  /** Attach to the element wrapping the scroll area. */
  rootRef: RefObject<HTMLDivElement | null>
  /** True while the tail is out of view: the jump-to-latest control is shown. */
  jumpVisible: boolean
  /** Content arrived while the reader was away from the tail. */
  unread: boolean
  /** Animate to the tail and resume following. */
  scrollToLatest: () => void
  /** Snap to the tail without animating and resume following. */
  pinToLatest: () => void
}

/**
 * Keeps a chat transcript pinned to its tail while content streams in, the way a
 * chat client does: growth follows the reader only while they sit at the bottom,
 * and scrolling up hands control back to them.
 */
export function useChatScroll({ active, resetKey }: ChatScrollOptions): ChatScroll {
  const rootRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLElement | null>(null)
  const followingRef = useRef(true)
  const smoothUntilRef = useRef(0)
  const contentHeightRef = useRef(0)
  const [jumpVisible, setJumpVisible] = useState(false)
  const [unread, setUnread] = useState(false)

  const pin = useCallback(() => {
    const viewport = viewportRef.current
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [])

  useEffect(() => {
    const root = rootRef.current
    const viewport = active ? root?.querySelector<HTMLElement>(VIEWPORT_SELECTOR) : null
    const transcript = active ? root?.querySelector<HTMLElement>(TRANSCRIPT_SELECTOR) : null
    if (!viewport || !transcript) {
      viewportRef.current = null
      followingRef.current = true
      setJumpVisible(false)
      setUnread(false)
      return
    }

    viewportRef.current = viewport
    followingRef.current = true
    smoothUntilRef.current = 0
    contentHeightRef.current = transcript.scrollHeight
    setJumpVisible(false)
    setUnread(false)
    pin()

    const handleScroll = (): void => {
      // The jump-to-latest animation is still moving the viewport.
      if (performance.now() < smoothUntilRef.current) return
      const following = isNearBottom(scrollMetrics(viewport))
      followingRef.current = following
      setJumpVisible(!following)
      if (following) setUnread(false)
    }
    // Any reader gesture takes the viewport back from an in-flight animation.
    const releaseAnimation = (): void => {
      smoothUntilRef.current = 0
    }
    // Streamed markdown, syntax highlighting and images grow the transcript after
    // the render that produced them, so keep measuring instead of scrolling once.
    const observer = new ResizeObserver(() => {
      const height = transcript.scrollHeight
      const grew = height > contentHeightRef.current
      contentHeightRef.current = height
      if (shouldFollowTail(followingRef.current, scrollMetrics(viewport))) {
        followingRef.current = true
        if (performance.now() >= smoothUntilRef.current) pin()
        return
      }
      if (grew) setUnread(true)
    })

    viewport.addEventListener('scroll', handleScroll, { passive: true })
    viewport.addEventListener('wheel', releaseAnimation, { passive: true })
    viewport.addEventListener('touchstart', releaseAnimation, { passive: true })
    viewport.addEventListener('pointerdown', releaseAnimation, { passive: true })
    viewport.addEventListener('keydown', releaseAnimation)
    observer.observe(transcript)
    observer.observe(viewport)

    return () => {
      observer.disconnect()
      viewport.removeEventListener('scroll', handleScroll)
      viewport.removeEventListener('wheel', releaseAnimation)
      viewport.removeEventListener('touchstart', releaseAnimation)
      viewport.removeEventListener('pointerdown', releaseAnimation)
      viewport.removeEventListener('keydown', releaseAnimation)
      viewportRef.current = null
    }
  }, [active, resetKey, pin])

  const scrollToLatest = useCallback(() => {
    followingRef.current = true
    setJumpVisible(false)
    setUnread(false)
    const viewport = viewportRef.current
    if (!viewport) return
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      smoothUntilRef.current = 0
      viewport.scrollTop = viewport.scrollHeight
      return
    }
    smoothUntilRef.current = performance.now() + CHAT_SMOOTH_SCROLL_MS
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })
  }, [])

  const pinToLatest = useCallback(() => {
    followingRef.current = true
    smoothUntilRef.current = 0
    setJumpVisible(false)
    setUnread(false)
    // The message that triggered this may not be committed yet; the observer
    // pins again as soon as it lands.
    requestAnimationFrame(pin)
  }, [pin])

  return { rootRef, jumpVisible, unread, scrollToLatest, pinToLatest }
}
