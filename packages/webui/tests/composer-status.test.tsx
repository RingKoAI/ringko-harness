import { expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SessionUsage } from '../src/api'
import { ComposerStatus } from '../src/components/composer-status'
import { TooltipProvider } from '../src/components/ui/tooltip'
import { I18nProvider } from '../src/i18n'
import { normalizeSessionUsage } from '../src/lib/session-usage'
import { contextPercent } from '../src/lib/context-usage'

const usage: SessionUsage = { calls: 1, inputTokens: 10_000, outputTokens: 426, totalTokens: 10_426, cacheReadTokens: 9990, cacheWriteTokens: null, cacheHitRate: 0.999, cacheReportedCalls: 1, partial: false, outputTokensPerSecond: 213 }
const render = (value: SessionUsage | null, context?: { used: number; limit: number }) => renderToStaticMarkup(<I18nProvider><TooltipProvider><ComposerStatus usage={value} context={context} /></TooltipProvider></I18nProvider>)

it('shows actual generation speed, cache rate and context percentage in the footer', () => {
  const html = render(usage, { used: 570, limit: 1000 })
  expect(html).toContain('213 tok/s')
  expect(html).toContain('99.9%')
  expect(html).toContain('57%')
})

it('keeps unknown speed, cache and context distinct from measured zeros', () => {
  const unknown = render(null)
  expect(unknown).toContain('— tok/s')
  expect(unknown).not.toContain('0%')
  const zero = render({ ...usage, outputTokensPerSecond: 0, cacheHitRate: 0 }, { used: 0, limit: 1000 })
  expect(zero).toContain('0 tok/s')
  expect(zero).toContain('0%')
})

it('accepts legacy payloads and rejects malformed speed metrics', () => {
  expect(normalizeSessionUsage(usage)?.outputTokensPerSecond).toBe(213)
  for (const value of [-1, Infinity, '213']) expect(normalizeSessionUsage({ ...usage, outputTokensPerSecond: value })).toBeNull()
  const { outputTokensPerSecond: _rate, ...legacy } = usage
  expect(normalizeSessionUsage(legacy)).toEqual(legacy)
})

it('shows small nonzero context occupancy rather than rounding it to zero', () => {
  expect(contextPercent(1906, 1_050_000, 'en')).toBe('0.2')
  expect(contextPercent(1, 1_050_000, 'en')).toBe('<0.1')
  expect(contextPercent(0, 1_050_000, 'en')).toBe('0')
  expect(render(usage, { used: 1906, limit: 1_050_000 })).toContain('0.2')
})
