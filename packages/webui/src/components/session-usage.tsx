import { ChartNoAxesCombined, Info } from 'lucide-react'
import type { SessionUsage } from '@/api'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { formatTokens } from '@/lib/session-usage'
import { useApp } from '@/store'

function cacheRate(usage: SessionUsage | null, locale: string): string | null {
  return usage?.cacheHitRate != null ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(usage.cacheHitRate) : null
}

export function SessionUsageCard({ usage }: { usage: SessionUsage | null }) {
  const { t, locale } = useI18n()
  const rate = cacheRate(usage, locale)
  return <section aria-label={t('usage.title')} className="rounded-xl border border-sidebar-border bg-sidebar-accent/40 px-3 py-2.5">
    <div className="flex items-center gap-1.5 text-xs font-medium text-sidebar-foreground">
      <ChartNoAxesCombined aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">{t('usage.title')}</span>
      <Tooltip>
        <TooltipTrigger asChild><span tabIndex={0} role="img" aria-label={t('usage.explanation')} className="rounded text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"><Info aria-hidden="true" className="size-3.5" /></span></TooltipTrigger>
        <TooltipContent side="right" className="max-w-64">{t('usage.explanation')}</TooltipContent>
      </Tooltip>
    </div>
    <div className="mt-2 flex items-baseline gap-1.5">
      <span className="text-xl font-semibold tracking-tight tabular-nums">{formatTokens(usage?.totalTokens ?? null, locale)}</span>
      <span className="text-[10px] text-muted-foreground">Tokens</span>
    </div>
    <dl className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
      <div><dt className="text-muted-foreground">{t('usage.input')}</dt><dd className="mt-0.5 font-medium tabular-nums">{formatTokens(usage?.inputTokens ?? null, locale)}</dd></div>
      <div><dt className="text-muted-foreground">{t('usage.output')}</dt><dd className="mt-0.5 font-medium tabular-nums">{formatTokens(usage?.outputTokens ?? null, locale)}</dd></div>
    </dl>
    <div className="mt-2.5 border-t border-sidebar-border pt-2 text-[11px]">
      <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">{t('usage.cacheHit')}</span><span className="font-medium tabular-nums">{rate ?? t('usage.unavailable')}</span></div>
      <p className="mt-1 text-muted-foreground">{usage?.cacheReadTokens != null ? t('usage.cacheRead', { count: formatTokens(usage.cacheReadTokens, locale) }) : t('usage.noCacheData')}</p>
      {usage?.cacheHitRate != null && usage.cacheReportedCalls < usage.calls ? <p className="mt-1 text-[10px] text-muted-foreground">{t('usage.cacheCoverage', { count: usage.cacheReportedCalls, total: usage.calls })}</p> : null}
    </div>
    <p className="mt-2 text-[10px] text-muted-foreground">{usage ? t(usage.partial ? 'usage.partialCalls' : 'usage.calls', { count: usage.calls }) : t('usage.empty')}</p>
  </section>
}

export function SidebarUsage() {
  const app = useApp()
  const { t, locale } = useI18n()
  const label = `${t('usage.title')}: ${formatTokens(app.usage?.totalTokens ?? null, locale)} Tokens · ${t('usage.cacheHit')}: ${cacheRate(app.usage, locale) ?? t('usage.unavailable')}`
  return <>
    <div className="my-1 group-data-[collapsible=icon]:hidden"><SessionUsageCard usage={app.usage} /></div>
    <Tooltip>
      <TooltipTrigger asChild><div role="img" tabIndex={0} aria-label={label} className="hidden size-8 items-center justify-center rounded-md text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring group-data-[collapsible=icon]:flex"><ChartNoAxesCombined aria-hidden="true" className="size-4" /></div></TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  </>
}
