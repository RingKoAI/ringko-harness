import { expect, it } from 'bun:test'
import {
  canQuickJump,
  quickJumpAnchorId,
  quickJumpDensity,
  quickJumpPreview,
  QUICK_JUMP_MAX_ITEMS,
  QUICK_JUMP_PREVIEW_LENGTH,
  QUICK_JUMP_RAIL_HEIGHT,
  resolveQuickJumpIndex,
} from '../src/lib/quick-jump'

it('anchors each message by its own id', () => {
  expect(quickJumpAnchorId('12')).toBe('chat-message-12')
  expect(quickJumpAnchorId('0')).not.toBe(quickJumpAnchorId('0 '))
})

it('only offers the rail for transcripts worth scanning', () => {
  expect(canQuickJump(0)).toBe(false)
  expect(canQuickJump(1)).toBe(false)
  expect(canQuickJump(2)).toBe(true)
  expect(canQuickJump(QUICK_JUMP_MAX_ITEMS)).toBe(true)
  expect(canQuickJump(QUICK_JUMP_MAX_ITEMS + 1)).toBe(false)
})

it('flattens a message into a bounded single-line preview', () => {
  expect(quickJumpPreview('  first\n\n second\tthird  ')).toBe('first second third')
  expect(quickJumpPreview('')).toBe('')
  expect(quickJumpPreview('x'.repeat(QUICK_JUMP_PREVIEW_LENGTH))).toHaveLength(QUICK_JUMP_PREVIEW_LENGTH)
  const clipped = quickJumpPreview('y'.repeat(QUICK_JUMP_PREVIEW_LENGTH + 50))
  expect(clipped).toHaveLength(QUICK_JUMP_PREVIEW_LENGTH)
  expect(clipped.endsWith('…')).toBe(true)
})

it('tracks the last message that already crossed the reading line', () => {
  const anchors = [{ top: 0 }, { top: 100 }, { top: 400 }, { top: 900 }]
  expect(resolveQuickJumpIndex(anchors, -50)).toBe(0)
  expect(resolveQuickJumpIndex(anchors, 0)).toBe(0)
  expect(resolveQuickJumpIndex(anchors, 99)).toBe(0)
  expect(resolveQuickJumpIndex(anchors, 100)).toBe(1)
  expect(resolveQuickJumpIndex(anchors, 899)).toBe(2)
  expect(resolveQuickJumpIndex(anchors, 5000)).toBe(3)
  expect(resolveQuickJumpIndex([], 120)).toBe(0)
})

it('thins the rail out so it never outgrows the viewport', () => {
  const tallest = (count: number): number => {
    const { bar, gap } = quickJumpDensity(count)
    expect(bar).toBeGreaterThan(0)
    expect(gap).toBeGreaterThanOrEqual(0)
    return count * bar + (count - 1) * gap
  }
  expect(tallest(2)).toBeLessThan(tallest(24))
  expect(tallest(QUICK_JUMP_MAX_ITEMS)).toBeLessThanOrEqual(QUICK_JUMP_RAIL_HEIGHT)
  expect(quickJumpDensity(10)).toEqual(quickJumpDensity(24))
  expect(quickJumpDensity(QUICK_JUMP_MAX_ITEMS).bar).toBeLessThan(quickJumpDensity(10).bar)
})
