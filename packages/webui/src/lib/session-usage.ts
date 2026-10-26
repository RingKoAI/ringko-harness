import type { SessionUsage } from '@ringko-ai/client'

const COUNTERS = ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const
function count(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }

/** A malformed server value must not become a convincing zero or percentage. */
export function normalizeSessionUsage(value: unknown): SessionUsage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  if (!count(data.calls) || data.calls < 1 || !count(data.cacheReportedCalls) || data.cacheReportedCalls > data.calls || typeof data.partial !== 'boolean') return null
  if (COUNTERS.some(key => data[key] !== null && !count(data[key]))) return null
  if (data.cacheHitRate !== null && (typeof data.cacheHitRate !== 'number' || !Number.isFinite(data.cacheHitRate) || data.cacheHitRate < 0 || data.cacheHitRate > 1)) return null
  if (data.cacheHitRate !== null && data.cacheReportedCalls === 0) return null
  if (data.totalTokens !== null && (typeof data.inputTokens !== 'number' || typeof data.outputTokens !== 'number' || data.totalTokens !== data.inputTokens + data.outputTokens)) return null
  return {
    calls: data.calls,
    inputTokens: data.inputTokens as number | null, outputTokens: data.outputTokens as number | null,
    totalTokens: data.totalTokens as number | null, cacheReadTokens: data.cacheReadTokens as number | null,
    cacheWriteTokens: data.cacheWriteTokens as number | null, cacheHitRate: data.cacheHitRate as number | null,
    cacheReportedCalls: data.cacheReportedCalls, partial: data.partial,
  }
}

export function formatTokens(value: number | null, locale: string): string {
  return value === null ? '—' : new Intl.NumberFormat(locale).format(value)
}
