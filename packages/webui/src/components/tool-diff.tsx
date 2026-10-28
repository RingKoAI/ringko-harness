import type { LineDiff } from '@/lib/edit-diff'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

/** Compact unified diff for one tool's file edit. */
export function ToolDiff({ path, diff }: { path: string; diff: LineDiff }) {
  const { t } = useI18n()
  return (
    <div className="mt-1 min-w-0 overflow-hidden rounded-md border bg-background/60 text-[11px]">
      <div className="flex min-w-0 items-center gap-2 border-b bg-muted/30 px-2 py-1">
        <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground" title={path}>{path}</span>
        <span className="shrink-0 tabular-nums">
          <span className="text-emerald-600 dark:text-emerald-400">+{diff.additions}</span>
          <span className="mx-1 text-muted-foreground">/</span>
          <span className="text-destructive">−{diff.deletions}</span>
        </span>
      </div>
      <pre className="max-h-72 overflow-auto p-0 font-mono leading-relaxed" aria-label={t('diff.lines', { added: diff.additions, removed: diff.deletions })}>
        {diff.lines.map((line, index) => (
          <div
            key={index}
            className={cn(
              'flex min-w-0 gap-2 px-2',
              line.kind === 'add' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
              line.kind === 'remove' && 'bg-destructive/10 text-destructive',
              line.kind === 'context' && 'text-muted-foreground',
            )}
          >
            <span aria-hidden="true" className="w-3 shrink-0 select-none text-right opacity-60">{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}</span>
            <span className="min-w-0 whitespace-pre-wrap break-words">{line.text || ' '}</span>
          </div>
        ))}
        {diff.truncated ? <div className="px-2 py-1 text-muted-foreground">{t('diff.truncated')}</div> : null}
      </pre>
    </div>
  )
}
