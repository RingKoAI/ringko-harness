import type { UsageStatisticsQuery } from '@/api'

export type UsageRange = 'today' | '7d' | '30d' | 'all' | 'custom'
export const USAGE_REFRESH_MS = 30_000
export const USAGE_PAGE_SIZE = 25

function localDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00`)
  return Number.isFinite(date.getTime()) && date.getFullYear() === Number(value.slice(0, 4))
    && date.getMonth() + 1 === Number(value.slice(5, 7)) && date.getDate() === Number(value.slice(8, 10)) ? date : null
}

/** Local calendar boundaries retain daylight-saving transitions; the end is exclusive. */
export function usageRange(range: UsageRange, start: string, end: string, now = new Date()): Pick<UsageStatisticsQuery, 'start' | 'end'> | null {
  if (range === 'all') return {}
  if (range === 'custom') {
    const from = localDate(start), to = localDate(end)
    if (!from || !to || from.getTime() < 0 || from > to || from > now || to > now) return null
    to.setDate(to.getDate() + 1)
    return { start: from.getTime(), end: Math.min(to.getTime(), now.getTime() + 1) }
  }
  const from = new Date(now)
  from.setHours(0, 0, 0, 0)
  from.setDate(from.getDate() - (range === '7d' ? 6 : range === '30d' ? 29 : 0))
  return { start: from.getTime() }
}

export function localDateInput(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
