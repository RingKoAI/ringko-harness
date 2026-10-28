import { useEffect, useState } from 'react'
import { ArrowLeft, LoaderCircle, Square } from 'lucide-react'
import { cancelTask, fetchTaskDetail, type TaskRecord, type TaskSummary } from '@/api'
import { useI18n } from '@/i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Markdown } from '@/components/markdown'
import { cn } from '@/lib/utils'

const POLL_MS = 1_000
const MAX_RECORDS = 1000

/**
 * Inline view of one delegated task's recorded events. Polls until the task
 * leaves the running state, and can cancel it without relying on job summaries.
 */
export function TaskView({ sessionId, taskId, onBack }: { sessionId: string; taskId: string; onBack(): void }) {
  const { t } = useI18n()
  const [task, setTask] = useState<TaskSummary | null>(null)
  const [records, setRecords] = useState<TaskRecord[]>([])
  const [error, setError] = useState('')
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    let active = true
    let cursor = -1
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      try {
        const page = await fetchTaskDetail(sessionId, taskId, cursor)
        if (!active) return
        cursor = page.cursor
        setTask(page.task)
        setError('')
        setRecords(previous => [...previous, ...page.records].slice(-MAX_RECORDS))
        if (page.task.status === 'running') timer = setTimeout(() => void poll(), page.records.length === 100 ? 0 : POLL_MS)
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause))
      }
    }
    void poll()
    return () => { active = false; clearTimeout(timer) }
  }, [sessionId, taskId])

  async function cancel(): Promise<void> {
    setCancelling(true)
    try { await cancelTask(sessionId, taskId); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setCancelling(false) }
  }

  return (
    <section aria-label={t('task.view')} className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 sm:px-4">
        <Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft />{t('task.back')}</Button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{task?.description ?? t('task.loading')}</span>
        {task ? <Badge variant="outline">{t(`task.${task.mode}`)}</Badge> : null}
        {task?.model ? <Badge variant="outline">{task.model}</Badge> : null}
        {task ? <span className={cn('text-xs text-muted-foreground', task.status === 'failed' && 'text-destructive')}>{t(`task.${task.status}`)}</span> : null}
        {task?.status === 'running' ? (
          <Button size="sm" variant="outline" disabled={cancelling} onClick={() => void cancel()}><Square />{t('task.cancel')}</Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4">
        <div className="chat-column space-y-3">
          {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
          {task?.status === 'running' && !records.length ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />{t('task.loading')}</p> : null}
          {task?.reason ? <p className="text-sm text-destructive">{task.reason}</p> : null}
          {records.map(record => {
            const event = record.data.event
            return (
              <article key={record.seq} className="rounded-lg border p-3">
                <header className="mb-2 text-xs text-muted-foreground">#{record.seq} · {event?.toolName ?? event?.type ?? record.type} · {new Date(record.time).toLocaleTimeString()}</header>
                {event?.message?.role === 'assistant' ? (
                  <>
                    <Markdown content={event.message.content} />
                    {event.message.reasoning ? <details className="mt-2"><summary className="cursor-pointer text-xs text-muted-foreground">{t('ui.showThinking')}</summary><p className="mt-1 text-sm whitespace-pre-wrap break-words text-muted-foreground">{event.message.reasoning}</p></details> : null}
                    {event.message.toolCalls?.length ? <pre className="mt-2 overflow-auto text-xs whitespace-pre-wrap break-words">{JSON.stringify(event.message.toolCalls, null, 2)}</pre> : null}
                  </>
                ) : (
                  <pre className="max-h-80 overflow-auto text-xs whitespace-pre-wrap break-words">{event?.message?.content ?? record.data.result?.content ?? record.data.reason ?? record.type}</pre>
                )}
              </article>
            )
          })}
          {!error && task && !records.length && task.status !== 'running' ? <p className="text-sm text-muted-foreground">{t('task.emptyEvents')}</p> : null}
          {task?.content ? <article className="rounded-lg border bg-muted/20 p-3"><Markdown content={task.content} /></article> : null}
        </div>
      </div>
    </section>
  )
}
