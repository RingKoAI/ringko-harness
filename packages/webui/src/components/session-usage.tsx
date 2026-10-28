import type { SessionUsage } from '@/api'
import { useI18n } from '@/i18n'
import { formatTokens } from '@/lib/session-usage'

function cacheRate(usage: SessionUsage | null, locale: string): string | null {
  return usage?.cacheHitRate != null ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(usage.cacheHitRate) : null
}

export function SessionUsageCard({ usage }: { usage: SessionUsage | null }) {
  const { t, locale } = useI18n()
  const rate = cacheRate(usage, locale)
  return (
    <section aria-label={t('usage.title')} className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('usage.explanation')}</p>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tracking-tight tabular-nums">{formatTokens(usage?.totalTokens ?? null, locale)}</span>
        <span className="text-xs text-muted-foreground">Tokens</span>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">{t('usage.input')}</dt>
          <dd className="mt-0.5 font-medium tabular-nums">{formatTokens(usage?.inputTokens ?? null, locale)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('usage.output')}</dt>
          <dd className="mt-0.5 font-medium tabular-nums">{formatTokens(usage?.outputTokens ?? null, locale)}</dd>
        </div>
      </dl>
      <div className="border-t pt-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">{t('usage.cacheHit')}</span>
          <span className="font-medium tabular-nums">{rate ?? t('usage.unavailable')}</span>
        </div>
        <p className="mt-1 text-muted-foreground">
          {usage?.cacheReadTokens != null ? t('usage.cacheRead', { count: formatTokens(usage.cacheReadTokens, locale) }) : t('usage.noCacheData')}
        </p>
        {usage?.cacheHitRate != null && usage.cacheReportedCalls < usage.calls ? (
          <p className="mt-1 text-xs text-muted-foreground">{t('usage.cacheCoverage', { count: usage.cacheReportedCalls, total: usage.calls })}</p>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {usage ? t(usage.partial ? 'usage.partialCalls' : 'usage.calls', { count: usage.calls }) : t('usage.empty')}
      </p>
    </section>
  )
}
