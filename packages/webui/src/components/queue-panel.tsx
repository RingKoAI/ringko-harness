import { useState } from 'react'
import { Check, ListOrdered, Pencil, Play, Trash2, X } from 'lucide-react'
import { useApp } from '@/store'
import { useI18n } from '@/i18n'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'

/** Ordered composer queue: one row per pending submission, sent FIFO after the active run. */
export function QueuePanel() {
  const app = useApp()
  const { t } = useI18n()
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  if (!app.queue.length) return null
  return (
    <section aria-label={t('queue.title')} className="mb-2 w-full min-w-0 rounded-xl border bg-muted/20 p-2.5">
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <ListOrdered className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-medium">{t('queue.title')}</span>
        <Badge variant="secondary" className="tabular-nums">{app.queue.length}</Badge>
        {!app.busy ? (
          <Button size="sm" variant="outline" onClick={app.resumeQueue}>
            <Play className="size-3" />
            {t('queue.resume')}
          </Button>
        ) : null}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{app.busy ? t('queue.hintRunning') : t('queue.hint')}</p>
      <ol className="mt-2 max-h-40 min-w-0 space-y-1.5 overflow-y-auto">
        {app.queue.map((item, index) => (
          <li key={item.id} className="min-w-0 rounded-lg border bg-background/70 px-2 py-1.5">
            <div className="flex min-w-0 items-start gap-2">
              <span className="mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-muted text-[10px] tabular-nums" aria-hidden="true">{index + 1}</span>
              {editing === item.id ? (
                <Textarea
                  aria-label={t('queue.edit')}
                  value={draft}
                  onChange={event => setDraft(event.target.value)}
                  maxLength={65536}
                  className="min-h-16 min-w-0 flex-1 text-sm"
                />
              ) : (
                <p className="min-w-0 flex-1 text-sm break-words whitespace-pre-wrap">
                  {item.prompt}
                  {item.attachments.length ? <span className="mt-0.5 block text-[11px] text-muted-foreground">{t('queue.attachments', { count: item.attachments.length })}</span> : null}
                </p>
              )}
              <div className="flex shrink-0 items-center">
                {editing === item.id ? (
                  <>
                    <Button variant="ghost" size="icon" className="size-7" aria-label={t('queue.save')} disabled={!draft.trim()} onClick={() => { app.editQueued(item.id, draft); setEditing(null) }}><Check className="size-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="size-7" aria-label={t('queue.cancel')} onClick={() => setEditing(null)}><X className="size-3.5" /></Button>
                  </>
                ) : (
                  <>
                    <Button variant="ghost" size="icon" className="size-7" aria-label={t('queue.edit')} onClick={() => { setEditing(item.id); setDraft(item.prompt) }}><Pencil className="size-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="size-7" aria-label={t('queue.remove')} onClick={() => app.removeQueued(item.id)}><Trash2 className="size-3.5" /></Button>
                  </>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
