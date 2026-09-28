import { useEffect, useState } from 'react'
import { fetchTaskDetail, type TaskRecord, type TaskSummary } from '@/api'
import { useI18n } from '@/i18n'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from './ui/sheet'
import { Markdown } from './markdown'

export function TaskDetail({ sessionId, taskId, onClose }: { sessionId: string; taskId: string; onClose(): void }) {
  const { t } = useI18n(); const [records, setRecords] = useState<TaskRecord[]>([])
  const [task, setTask] = useState<TaskSummary | null>(null); const [error, setError] = useState('')
  useEffect(() => {
    let active = true; let cursor = -1; let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const page = await fetchTaskDetail(sessionId, taskId, cursor)
        if (!active) return
        cursor = page.cursor; setTask(page.task); setError('')
        setRecords(previous => [...previous, ...page.records].slice(-1000))
        if (page.records.length === 100 || page.task.status === 'running') timer = setTimeout(poll, page.records.length === 100 ? 0 : 1000)
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : String(cause)) }
    }
    void poll(); return () => { active = false; clearTimeout(timer) }
  }, [sessionId, taskId])
  return <Sheet open onOpenChange={open => { if (!open) onClose() }}><SheetContent className="w-full! overflow-hidden sm:max-w-2xl!">
    <SheetHeader><SheetTitle>{task?.description ?? t('task.loading')}</SheetTitle><SheetDescription>{t('task.events')} · {task?.model} · {taskId}</SheetDescription></SheetHeader>
    <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 pb-6">
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      {task ? <p className="text-sm text-muted-foreground">{t(`task.${task.mode}`)} · {t(`task.${task.status}`)}{task.parentCallId ? ` · ${task.parentCallId}` : ''}</p> : null}
      {records.map(record => { const event = record.data.event; return <article key={record.seq} className="rounded-lg border p-3">
        <header className="mb-2 text-xs text-muted-foreground">#{record.seq} · {event?.toolName ?? event?.type ?? record.type} · {new Date(record.time).toLocaleTimeString()}</header>
        {event?.message?.role === 'assistant' ? <><Markdown content={event.message.content} />{event.message.reasoning ? <details><summary>{t('ui.showThinking')}</summary><p className="whitespace-pre-wrap break-words text-sm">{event.message.reasoning}</p></details> : null}{event.message.toolCalls?.length ? <pre className="overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(event.message.toolCalls, null, 2)}</pre> : null}</> : <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{event?.message?.content ?? record.data.result?.content ?? record.data.reason ?? record.type}</pre>}
      </article> })}
      {!error && task && !records.length ? <p>{t('task.emptyEvents')}</p> : null}
    </div>
  </SheetContent></Sheet>
}
