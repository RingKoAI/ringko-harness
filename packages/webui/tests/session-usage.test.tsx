import { expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '../src/i18n'
import { TooltipProvider } from '../src/components/ui/tooltip'
import { SessionUsageCard } from '../src/components/session-usage'
import { normalizeSessionUsage } from '../src/lib/session-usage'
import type { SessionUsage } from '../src/api'

const usage: SessionUsage = { calls: 1, inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadTokens: 60, cacheWriteTokens: null, cacheHitRate: 0.6, cacheReportedCalls: 1, partial: false }

it('validates external numeric metrics instead of coercing malformed values to zero', () => {
  expect(normalizeSessionUsage(usage)).toEqual(usage)
  expect(normalizeSessionUsage({ ...usage, cacheHitRate: 2 })).toBeNull()
  expect(normalizeSessionUsage({ ...usage, inputTokens: -1 })).toBeNull()
  expect(normalizeSessionUsage({ ...usage, totalTokens: '120' })).toBeNull()
  expect(normalizeSessionUsage(null)).toBeNull()
})

it('renders actual counts and ratio, while an unrecorded session has no fake zero-percent hit rate', () => {
  const render = (value: SessionUsage | null) => renderToStaticMarkup(<I18nProvider><TooltipProvider><SessionUsageCard usage={value} /></TooltipProvider></I18nProvider>)
  const known = render(usage)
  expect(known).toContain('120')
  expect(known).toContain('60%')
  const empty = render(null)
  expect(empty).not.toContain('0%')
  expect(empty).toContain('—')
})
