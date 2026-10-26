import { LoaderCircle } from 'lucide-react'
import type { TodoStatus } from '@/api'
import { Checkbox } from '@/components/ui/checkbox'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

/** Status display only: model-authored tasks cannot be toggled by the reader. */
export function TaskMarker({ status, className }: { status: TodoStatus; className?: string }) {
  const { t } = useI18n()
  const label = t(`todo.status.${status}`)
  return <span className={cn('relative inline-flex size-4 shrink-0 items-center justify-center align-middle', className)} data-task-marker={status}>
    {status === 'in_progress' ? (
      <span role="img" aria-label={label} className="inline-flex size-4 items-center justify-center rounded-[4px] border border-primary/30 bg-primary/10 text-foreground">
        <LoaderCircle aria-hidden="true" className="size-3 motion-safe:animate-spin" />
      </span>
    ) : (
      <Checkbox
        checked={status === 'completed'}
        disabled
        aria-label={label}
        className={cn(
          'cursor-default disabled:cursor-default disabled:opacity-100',
          status === 'completed'
            ? 'border-emerald-600 bg-emerald-600 text-white data-[state=checked]:border-emerald-600 data-[state=checked]:bg-emerald-600 data-[state=checked]:text-white dark:border-emerald-400 dark:bg-emerald-400 dark:text-emerald-950 dark:data-[state=checked]:bg-emerald-400 dark:data-[state=checked]:text-emerald-950'
            : 'border-muted-foreground/40 bg-background/80 dark:bg-background/50',
        )}
      />
    )}
  </span>
}
