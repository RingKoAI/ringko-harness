import { CircleDashed, Database, Gauge } from 'lucide-react'
import type { ReactNode } from 'react'
import type { SessionUsage } from '@/api'
import { ContextRingLabeled } from '@/components/context-ring'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'

const SCIENTIFIC_SPEED_THRESHOLD = 1_000_000

function Metric({ label, description, children }: { label: string; description: string; children: ReactNode }) {
  return <Tooltip>
    <TooltipTrigger asChild>
      <span role="img" aria-label={label} tabIndex={0} className="inline-flex items-center gap-1.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {children}
      </span>
    </TooltipTrigger>
    <TooltipContent className="max-w-72">{description}</TooltipContent>
  </Tooltip>
}

/** Actual call/session metrics share a compact row below the composer. */
export function ComposerStatus({ usage, context }: { usage: SessionUsage | null; context?: { used: number; limit: number } | null }) {
  const { t, locale } = useI18n()
  const speed = usage?.outputTokensPerSecond != null ? new Intl.NumberFormat(locale, { maximumFractionDigits: 1, notation: usage.outputTokensPerSecond >= SCIENTIFIC_SPEED_THRESHOLD ? 'scientific' : 'standard' }).format(usage.outputTokensPerSecond) : '—'
  const rate = usage?.cacheHitRate != null ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(usage.cacheHitRate) : t('usage.unavailable')
  const knownContext = context && Number.isFinite(context.used) && context.used >= 0 && Number.isFinite(context.limit) && context.limit > 0
  return <div role="region" aria-label={t('composer.stats')} className="mt-2 flex min-h-4 max-w-full flex-wrap items-center justify-center gap-x-5 gap-y-1 text-[10px] leading-4 text-muted-foreground tabular-nums">
    <Metric label={`${t('composer.speed')}: ${speed} tok/s`} description={t(usage?.outputTokensPerSecond != null ? 'composer.speedDetails' : 'composer.speedUnavailable')}>
      <Gauge aria-hidden="true" className="size-3" /><span>{`${speed} tok/s`}</span>
    </Metric>
    <Metric label={`${t('usage.cacheHit')}: ${rate}`} description={t('composer.cacheDetails')}>
      <Database aria-hidden="true" className="size-3" /><span>{t('usage.cacheHit')} {rate}</span>
    </Metric>
    {knownContext ? <ContextRingLabeled used={context.used} limit={context.limit} compact /> : <Metric label={`${t('composer.context')}: ${t('usage.unavailable')}`} description={t('usage.unavailable')}>
      <CircleDashed aria-hidden="true" className="size-3" /><span>—</span>
    </Metric>}
  </div>
}
