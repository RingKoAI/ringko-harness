import { expect, it } from 'bun:test'
import { clampSidebarWidth, filterSessions, readSidebarWidth, SIDEBAR_WIDTH_DEFAULT, SIDEBAR_WIDTH_KEY, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN } from '../src/lib/sidebar'

it('clamps the sidebar width into the supported range and rounds it', () => {
  expect(clampSidebarWidth(0)).toBe(SIDEBAR_WIDTH_MIN)
  expect(clampSidebarWidth(-100)).toBe(SIDEBAR_WIDTH_MIN)
  expect(clampSidebarWidth(10_000)).toBe(SIDEBAR_WIDTH_MAX)
  expect(clampSidebarWidth(255.6)).toBe(256)
  expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_WIDTH_DEFAULT)
  expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(SIDEBAR_WIDTH_DEFAULT)
})

it('reads a persisted width and falls back when storage is missing or invalid', () => {
  expect(readSidebarWidth({ getItem: key => key === SIDEBAR_WIDTH_KEY ? '300' : null })).toBe(300)
  expect(readSidebarWidth({ getItem: () => '21' })).toBe(SIDEBAR_WIDTH_MIN)
  expect(readSidebarWidth({ getItem: () => 'not-a-number' })).toBe(SIDEBAR_WIDTH_DEFAULT)
  expect(readSidebarWidth({ getItem: () => null })).toBe(SIDEBAR_WIDTH_DEFAULT)
  expect(readSidebarWidth({ getItem: () => { throw new Error('denied') } })).toBe(SIDEBAR_WIDTH_DEFAULT)
  expect(readSidebarWidth()).toBe(SIDEBAR_WIDTH_DEFAULT)
})

it('filters sessions by title, summary or id, case-insensitively', () => {
  const sessions = [
    { id: 'session-a', title: 'Fix login redirect', summary: 'OAuth callback' },
    { id: 'session-b', title: null, summary: null },
    { id: 'session-c', title: 'Workspace cleanup' },
  ]
  expect(filterSessions(sessions, '').length).toBe(3)
  expect(filterSessions(sessions, '   ').length).toBe(3)
  expect(filterSessions(sessions, 'LOGIN').map(item => item.id)).toEqual(['session-a'])
  expect(filterSessions(sessions, 'oauth').map(item => item.id)).toEqual(['session-a'])
  expect(filterSessions(sessions, 'session-b').map(item => item.id)).toEqual(['session-b'])
  expect(filterSessions(sessions, 'missing')).toEqual([])
})
