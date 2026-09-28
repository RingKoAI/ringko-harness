import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

const SIZE = 24
const STROKE = 3

/** Circular context-usage indicator; hover shows used / limit and percent. */
export function ContextRing({ used, limit }: { used: number; limit: number }) {
  const { t } = useI18n()
  const ratio = limit > 0 ? Math.min(1, Math.max(0, used / limit)) : 0
  const percent = Math.round(ratio * 100)
  const radius = (SIZE - STROKE) / 2
  const circumference = 2 * Math.PI * radius
  const tone = ratio >= 0.9 ? 'text-red-500' : ratio >= 0.7 ? 'text-amber-500' : 'text-primary'
  const label = t('context.usage', { used, limit, percent })

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="grid size-6 shrink-0 place-items-center" aria-label={label} title={label}>
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90">
            <circle cx={SIZE / 2} cy={SIZE / 2} r={radius} strokeWidth={STROKE} className="fill-none stroke-muted" />
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={radius}
              strokeWidth={STROKE}
              strokeLinecap="round"
              className={cn('fill-none transition-[stroke-dashoffset]', tone)}
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

/** Ring plus a small percent label, for the composer's send row. */
export function ContextRingLabeled({ used, limit }: { used: number; limit: number }) {
  const { t } = useI18n()
  const ratio = limit > 0 ? Math.min(1, Math.max(0, used / limit)) : 0
  const percent = Math.round(ratio * 100)
  return (
    <span className="flex items-center gap-1.5">
      <ContextRing used={used} limit={limit} />
      <span className="text-[10px] text-muted-foreground tabular-nums" title={t('context.usage', { used, limit, percent })}>
        {percent}%
      </span>
    </span>
  )
}
