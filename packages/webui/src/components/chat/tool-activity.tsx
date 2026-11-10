import { Terminal, Wrench } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ServerMessage, ToolCall } from '@/api'
import { ToolDiff } from '@/components/tool-diff'
import { editDiff } from '@/lib/edit-diff'
import { toolCallTarget, type ToolTurn } from '@/lib/tool-activity'
import { cn } from '@/lib/utils'
import type { useI18n } from '@/i18n'

type Translate = ReturnType<typeof useI18n>['t']

/** One-line summary for a tool result; glob/grep collapse to their match count. */
export function toolSummary(t: Translate, name: string | undefined, content: string): string {
  if (name === 'glob' || name === 'grep') {
    try {
      const parsed = JSON.parse(content) as { matches?: unknown[] }
      if (Array.isArray(parsed.matches)) {
        return t(name === 'glob' ? 'message.files' : 'message.matches', { count: parsed.matches.length })
      }
    } catch {
      // Not JSON; fall through to the first line.
    }
  }
  const first = content.split('\n')[0] ?? ''
  return first.length > 80 ? `${first.slice(0, 80)}…` : first
}

export function ToolCallList({ calls, results, busy, showDetails, t }: { calls: readonly ToolCall[]; results?: ReadonlyMap<string, ServerMessage>; busy: boolean; showDetails: boolean; t: Translate }) {
  if (calls.length === 0) return null
  return (
    <div className="space-y-1">
      {calls.map((call) => {
        const result = results?.get(call.id)
        const status = result?.failed ? t('message.failed') : result ? t('message.completed') : busy ? t('message.working') : t('message.unknown')
        const target = toolCallTarget(call.arguments)
        const summary = result ? toolSummary(t, call.name, result.content) : ''
        // Edits carry their exact before/after text, so the change renders as a
        // unified diff instead of JSON arguments or a one-line result summary.
        const diff = call.name === 'edit' ? editDiff(call.arguments) : undefined
        const heading = <>
          <Wrench className="size-3 shrink-0" aria-hidden="true" />
          <span className="shrink-0 font-mono">{call.name}</span>
          {target && <span className="min-w-0 truncate text-muted-foreground" title={target}>{target}</span>}
          <span className={cn('ml-auto shrink-0', result?.failed ? 'text-destructive' : 'text-muted-foreground')}>{status}</span>
        </>
        return showDetails ? (
          <details key={call.id} className="rounded-md border bg-muted/20 text-xs">
            <summary className="flex min-w-0 cursor-pointer items-center gap-2 px-3 py-1.5">{heading}</summary>
            <div className="space-y-2 border-t px-3 py-2">
              {diff ? <ToolDiff path={target ?? ''} diff={diff} /> : null}
              <div className="text-muted-foreground">{t('message.arguments')}</div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono">{JSON.stringify(call.arguments ?? {}, null, 2)}</pre>
              <div className="text-muted-foreground">{t('message.output')}</div>
              <pre className={cn('max-h-80 overflow-auto whitespace-pre-wrap break-all font-mono', result?.failed && 'text-destructive')}>{result?.content ?? status}</pre>
            </div>
          </details>
        ) : (
          <div key={call.id} className="min-w-0 rounded-md border bg-muted/20 px-3 py-1.5 text-xs">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {heading}
              {result && <span className={cn('w-full truncate pl-5', result.failed ? 'text-destructive' : 'text-muted-foreground')}>{summary}</span>}
            </div>
            {diff ? <ToolDiff path={target ?? ''} diff={diff} /> : null}
          </div>
        )
      })}
    </div>
  )
}

/** A stable per-turn disclosure; assistant prose stays outside the hidden tool process. */
export function TurnToolActivity({ turn, showDetails, override, onToggle, t, children }: { turn: ToolTurn; showDetails: boolean; override?: { details: boolean; open: boolean }; onToggle: (open: boolean) => void; t: Translate; children: (open: boolean) => ReactNode }) {
  const open = !turn.foldable || (override?.details === showDetails ? override.open : showDetails)
  return (
    <div className="min-w-0 space-y-4" data-tool-turn={turn.key}>
      {turn.count > 0 && <button type="button" aria-expanded={open} disabled={!turn.foldable} onClick={() => onToggle(!open)} className="flex min-h-10 w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-muted/20 px-3 py-2 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default">
        <Wrench className="size-3 shrink-0" aria-hidden="true" />
        <span className="font-medium">{t(turn.orphans ? 'activity.turnRecords' : 'activity.turnTitle', { count: turn.count })}</span>
        {[...turn.counts].map(([kind, count]) => <span key={kind} className="text-muted-foreground">{t(`activity.${kind}`)} {count}</span>)}
        {turn.additions + turn.deletions > 0 && <span className="shrink-0 tabular-nums"><span className="text-emerald-600 dark:text-emerald-400">+{turn.additions}</span><span className="mx-1 text-muted-foreground">/</span><span className="text-destructive">−{turn.deletions}</span></span>}
        {turn.failed > 0 && <span className="text-destructive">{t('activity.failed', { count: turn.failed })}</span>}
        {!turn.running && turn.unknown > 0 && <span className="text-destructive">{t('activity.unknown', { count: turn.unknown })}</span>}
        <span className="ml-auto shrink-0 text-muted-foreground">{turn.running ? t('message.working') : !turn.foldable ? t('activity.keptOpen') : open ? t('activity.hide') : t('activity.show')}</span>
      </button>}
      {children(open)}
    </div>
  )
}

export function ToolResult({ message, t }: { message: ServerMessage; t: Translate }) {
  return (
    <details className={cn('rounded-md border bg-muted/20', message.failed && 'border-destructive/50')}>
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs">
        <Terminal className="size-3 shrink-0" />
        <span className="font-mono">{message.name}</span>
        <span className={cn('truncate', message.failed ? 'text-destructive' : 'text-muted-foreground')}>{message.failed ? `${t('message.failed')} · ` : ''}{toolSummary(t, message.name, message.content)}</span>
      </summary>
      <pre className="max-h-80 overflow-auto px-3 pb-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
        {message.content}
      </pre>
    </details>
  )
}
