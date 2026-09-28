import { GitBranch, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { TaskDetail } from './task-detail'
import { useApp } from '@/store'
import { useI18n } from '@/i18n'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export function TaskPanel() {
  const { tasks, jobs, controlJob, sessionId } = useApp()
  const [selected, setSelected] = useState<string | null>(null)
  const { t } = useI18n()
  if (!tasks.length) return null
  return <section aria-label={t('task.title')} className="space-y-2">
    <h3 className="flex items-center gap-2 text-sm font-medium"><GitBranch className="size-4" />{t('task.title')}</h3>
    {tasks.map(task => { const job = jobs.find(item => item.jobId === task.taskId); return <details key={task.taskId} className="rounded-lg border bg-muted/20">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
        {task.status === 'running' ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <GitBranch aria-hidden className="size-4" />}
        <span className="min-w-0 flex-1 break-words">{task.description}</span>
        <Badge variant="outline">{t(`task.${task.mode}`)}</Badge>
        {task.model ? <Badge variant="outline">{task.model}</Badge> : null}
        {job?.background ? <Badge variant="secondary">{t('job.background')}</Badge> : null}
        <span className={cn('text-xs text-muted-foreground', task.status === 'failed' && 'text-destructive')}>{t(`task.${task.status}`)}</span>
      </summary>
      <div className="space-y-2 border-t px-3 py-2 text-xs">
        <Button size="sm" variant="outline" onClick={() => setSelected(task.taskId)}>{t('task.inspect')}</Button>
        <p className="break-all font-mono text-muted-foreground">{task.taskId}{task.parentCallId ? ` · ${task.parentCallId}` : ''}</p>
        {job?.status === 'running' ? <div className="flex gap-2">{!job.background ? <Button size="sm" variant="outline" onClick={() => controlJob(task.taskId, 'background')}>{t('job.detach')}</Button> : null}<Button size="sm" variant="outline" onClick={() => controlJob(task.taskId, 'cancel')}>{t('job.cancel')}</Button></div> : null}
        {task.activity ? <p>{task.activity}</p> : null}
        {task.reason ? <p className="text-destructive">{task.reason}</p> : null}
        {task.content ? <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words">{task.content}</pre> : null}
        <p className="text-muted-foreground">{t('task.detailsHint')}</p>
      </div>
    </details> })}
    {selected && sessionId ? <TaskDetail key={`${sessionId}/${selected}`} sessionId={sessionId} taskId={selected} onClose={() => setSelected(null)} /> : null}
  </section>
}
