import { Terminal, GitBranch } from 'lucide-react'
import { useApp } from '@/store'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'

export function JobPanel() {
  const { jobs: allJobs, controlJob } = useApp()
  const jobs = allJobs.filter(job => job.kind === 'shell')
  const { t } = useI18n()
  if (!jobs.length) return null
  return <section aria-label={t('job.title')} className="space-y-2">
    <h3 className="text-sm font-medium">{t('job.title')}</h3>
    {jobs.map(job => <details key={job.jobId} className="rounded-lg border bg-muted/20">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">{job.kind === 'shell' ? <Terminal className="size-4" /> : <GitBranch className="size-4" />}<span className="min-w-0 flex-1 break-words">{job.description}</span><span className="text-xs text-muted-foreground">{job.background ? t('job.background') : t('job.foreground')} · {t(`task.${job.status}`)}</span></summary>
      <div className="space-y-2 border-t p-3 text-xs">
        <p className="break-all font-mono text-muted-foreground">{job.jobId} · #{job.lastSeq}</p>
        {job.status === 'running' ? <div className="flex gap-2">{!job.background ? <Button size="sm" variant="outline" onClick={() => controlJob(job.jobId, 'background')}>{t('job.detach')}</Button> : null}<Button size="sm" variant="outline" onClick={() => controlJob(job.jobId, 'cancel')}>{t('job.cancel')}</Button><Button size="sm" variant="outline" onClick={() => controlJob(job.jobId, 'status')}>{t('job.result')}</Button></div> : null}
        {job.output ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words">{job.output}</pre> : null}
        {job.result !== undefined ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(job.result, null, 2)}</pre> : null}
      </div>
    </details>)}
  </section>
}
