import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { contextPercent, contextRatio } from '@/lib/context-usage'

const SIZE = 24
const STROKE = 3

/** Circular context-usage indicator; hover shows used / limit and percent. */
export function ContextRing({ used, limit, compact = false }: { used: number; limit: number; compact?: boolean }) {
  const { t, locale } = useI18n()
  const ratio = contextRatio(used, limit)
  const percent = contextPercent(used, limit, locale)
  const radius = (SIZE - STROKE) / 2
  const circumference = 2 * Math.PI * radius
  const tone = ratio >= 0.9 ? 'text-red-500' : ratio >= 0.7 ? 'text-amber-500' : compact ? 'text-muted-foreground' : 'text-primary'
  const label = t('context.usage', { used, limit, percent })

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span role="img" tabIndex={0} className={cn('grid shrink-0 place-items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', compact ? 'size-3' : 'size-6')} aria-label={label} title={label}>
          <svg aria-hidden="true" width={compact ? SIZE / 2 : SIZE} height={compact ? SIZE / 2 : SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90">
            <circle cx={SIZE / 2} cy={SIZE / 2} r={radius} strokeWidth={STROKE} className="fill-none stroke-muted" />
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={radius}
              strokeWidth={STROKE}
              strokeLinecap="round"
              className={cn('fill-none transition-[stroke-dashoffset] motion-reduce:transition-none', tone)}
              stroke="currentColor"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - ratio)}
            />
          </svg>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Ring plus a small percent label, with a compact variant for the status footer. */
export function ContextRingLabeled({ used, limit, compact = false }: { used: number; limit: number; compact?: boolean }) {
  const { t, locale } = useI18n()
  const percent = contextPercent(used, limit, locale)
  return (
    <span className="flex items-center gap-1.5">
      <ContextRing used={used} limit={limit} compact={compact} />
      <span className="text-[10px] text-muted-foreground tabular-nums" title={t('context.usage', { used, limit, percent })}>
        {percent}%
      </span>
    </span>
  )
}
