import { expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '../src/i18n'
import { UsageTrend } from '../src/components/usage-trend'
import { localDateInput, usageRange } from '../src/lib/usage-statistics'
import type { UsageStatistics } from '../src/api'

it('uses local calendar dates and an exclusive end for presets and custom filters', () => {
  const now = new Date(2026, 8, 15, 12)
  expect(usageRange('today', '', '', now)).toEqual({ start: new Date(2026, 8, 15).getTime() })
  expect(usageRange('7d', '', '', now)).toEqual({ start: new Date(2026, 8, 9).getTime() })
  expect(usageRange('30d', '', '', now)).toEqual({ start: new Date(2026, 7, 17).getTime() })
  expect(usageRange('all', '', '', now)).toEqual({})
  expect(usageRange('custom', '2026-09-01', '2026-09-02', now)).toEqual({ start: new Date(2026, 8, 1).getTime(), end: new Date(2026, 8, 3).getTime() })
  expect(usageRange('custom', '2026-09-15', '2026-09-15', now)?.end).toBe(now.getTime() + 1)
  expect(localDateInput(new Date(2026, 0, 2))).toBe('2026-01-02')
})

it('rejects incomplete, normalized-invalid, reversed and future custom date ranges', () => {
  const now = new Date(2026, 8, 15, 12)
  for (const [from, to] of [['', ''], ['2026-02-30', '2026-03-01'], ['2026-09-03', '2026-09-01'], ['2026-09-15', '2026-09-16']]) expect(usageRange('custom', from, to, now)).toBeNull()
})

it('renders an accessible trend without introducing cached tokens into total consumption', () => {
  const data = { grain: 'day', trend: [{ key: '2026-09-15', usage: { calls: 2, totalTokens: 120 } }] } as UsageStatistics
  const html = renderToStaticMarkup(<I18nProvider><UsageTrend data={data} /></I18nProvider>)
  expect(html).toContain('role="img"')
  expect(html).toContain('2026-09-15: 120')
  expect(html).toContain('aria-pressed="true"')
  expect(html).not.toContain('NaN')
  const empty = renderToStaticMarkup(<I18nProvider><UsageTrend data={{ ...data, trend: [] }} /></I18nProvider>)
  expect(empty).not.toContain('Infinity')
})
