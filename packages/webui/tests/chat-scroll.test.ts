import { expect, it } from 'bun:test'
import { CHAT_FOLLOW_THRESHOLD, isNearBottom, scrollMetrics, shouldFollowTail } from '../src/lib/chat-scroll'

const metrics = (scrollTop: number, scrollHeight: number, clientHeight: number) => ({ scrollTop, scrollHeight, clientHeight })

it('treats the tail within the threshold as following, including short content', () => {
  expect(isNearBottom(metrics(600, 1000, 400))).toBe(true)
  expect(isNearBottom(metrics(1000 - 400 - CHAT_FOLLOW_THRESHOLD, 1000, 400))).toBe(true)
  expect(isNearBottom(metrics(1000 - 400 - CHAT_FOLLOW_THRESHOLD - 1, 1000, 400))).toBe(false)
  expect(isNearBottom(metrics(0, 200, 400))).toBe(true)
})

it('reads metrics from a scroll element', () => {
  expect(scrollMetrics({ scrollTop: 10, scrollHeight: 100, clientHeight: 40 })).toEqual({ scrollTop: 10, scrollHeight: 100, clientHeight: 40 })
})

it('only follows new content when the reader was following or is back at the tail', () => {
  expect(shouldFollowTail(true, metrics(0, 1000, 400))).toBe(true)
  expect(shouldFollowTail(false, metrics(0, 1000, 400))).toBe(false)
  expect(shouldFollowTail(false, metrics(600, 1000, 400))).toBe(true)
})
