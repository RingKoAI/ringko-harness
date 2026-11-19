import { expect, it } from 'bun:test'
import { CHAT_FOLLOW_THRESHOLD, distanceFromTail, isNearBottom, scrollMetrics, shouldFollowTail } from '../src/lib/chat-scroll'

const metrics = (scrollTop: number, scrollHeight: number, clientHeight: number) => ({ scrollTop, scrollHeight, clientHeight })

it('measures the distance left before the tail', () => {
  expect(distanceFromTail(metrics(600, 1000, 400))).toBe(0)
  expect(distanceFromTail(metrics(500, 1000, 400))).toBe(100)
  expect(distanceFromTail(metrics(0, 1000, 400))).toBe(600)
})

it('reports no distance to travel when the content fits the viewport', () => {
  expect(distanceFromTail(metrics(0, 200, 400))).toBe(0)
  // Overscroll (rubber-banding, fractional layout) never reads as a negative gap.
  expect(distanceFromTail(metrics(620, 1000, 400))).toBe(0)
})

it('treats the tail within the threshold as following, including short content', () => {
  expect(isNearBottom(metrics(600, 1000, 400))).toBe(true)
  expect(isNearBottom(metrics(1000 - 400 - CHAT_FOLLOW_THRESHOLD, 1000, 400))).toBe(true)
  expect(isNearBottom(metrics(1000 - 400 - CHAT_FOLLOW_THRESHOLD - 1, 1000, 400))).toBe(false)
  expect(isNearBottom(metrics(0, 200, 400))).toBe(true)
})

it('honours a custom threshold', () => {
  expect(isNearBottom(metrics(500, 1000, 400), 99)).toBe(false)
  expect(isNearBottom(metrics(500, 1000, 400), 100)).toBe(true)
})

it('reads metrics from a scroll element', () => {
  expect(scrollMetrics({ scrollTop: 10, scrollHeight: 100, clientHeight: 40 })).toEqual({ scrollTop: 10, scrollHeight: 100, clientHeight: 40 })
})

it('only follows new content when the reader was following or is back at the tail', () => {
  expect(shouldFollowTail(true, metrics(0, 1000, 400))).toBe(true)
  expect(shouldFollowTail(false, metrics(0, 1000, 400))).toBe(false)
  expect(shouldFollowTail(false, metrics(600, 1000, 400))).toBe(true)
})

it('keeps a reader who scrolled away unpinned while content grows', () => {
  // Same scrollTop after 200px of streamed markdown: further from the tail.
  const before = metrics(200, 1000, 400)
  const after = metrics(200, 1200, 400)
  expect(shouldFollowTail(false, before)).toBe(false)
  expect(shouldFollowTail(false, after)).toBe(false)
  // A following reader stays pinned no matter how much content lands.
  expect(shouldFollowTail(true, after)).toBe(true)
})
