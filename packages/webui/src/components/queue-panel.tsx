import { useState } from 'react'
import { Check, CornerDownRight, ListOrdered, LoaderCircle, Pencil, Play, Send, Trash2, X } from 'lucide-react'
import { CONVERSATION_LIMITS, isPendingSessionId } from '@/lib/conversations'
import { useApp } from '@/store'
import { useI18n } from '@/i18n'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'

/** FIFO composer queue with mid-run steering and explicit interrupt-and-send actions. */
export function QueuePanel() {
  const app = useApp()
  const { t } = useI18n()
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [steeringId, setSteeringId] = useState<string | null>(null)
  const sending = app.sendingQueued !== null
  const pending = isPendingSessionId(app.sessionId)
  const steerableCount = app.queue.filter(item => !item.loop).length
  if (!app.queue.length) return null
  return (
    <section aria-label={t('queue.title')} className="mb-2 w-full min-w-0 rounded-xl border bg-muted/20 p-2.5">
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <ListOrdered className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-medium">{t('queue.title')}</span>
        <Badge variant="secondary" className="tabular-nums">{app.queue.length}</Badge>
        {app.busy && steerableCount > 1 && !pending ? (
          <Button
            size="sm"
            variant="outline"
            disabled={sending || steeringId !== null}
            title={t('queue.steerAllHint')}
            onClick={() => { void app.steerAllQueued() }}
          >
            <CornerDownRight className="size-3" />
            {t('queue.steerAll')}
          </Button>
        ) : null}
        {!app.busy ? (
          <Button size="sm" variant="outline" onClick={app.resumeQueue}>
            <Play className="size-3" />
            {t('queue.resume')}
          </Button>
        ) : null}
      </div>
      <p aria-live="polite" className="mt-1 text-[11px] text-muted-foreground">{sending ? t('queue.sendingHint') : app.busy ? t('queue.hintRunning') : t('queue.hint')}</p>
      <ol className="mt-2 max-h-40 min-w-0 space-y-1.5 overflow-y-auto">
        {app.queue.map((item, index) => (
          <li key={item.id} aria-busy={app.sendingQueued === item.id || steeringId === item.id} className="min-w-0 rounded-lg border bg-background/70 px-2 py-1.5">
            <div className="flex min-w-0 items-start gap-2">
              <span className="mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-muted text-[10px] tabular-nums" aria-hidden="true">{index + 1}</span>
              {editing === item.id ? (
                <Textarea
                  aria-label={t('queue.edit')}
                  value={draft}
                  onChange={event => setDraft(event.target.value)}
                  maxLength={CONVERSATION_LIMITS.prompt}
                  disabled={sending}
                  className="min-h-16 min-w-0 flex-1 text-sm"
                />
              ) : (
                <p className="min-w-0 flex-1 text-sm break-words whitespace-pre-wrap">
                  {item.prompt}
                  {item.attachments.length ? <span className="mt-0.5 block text-[11px] text-muted-foreground">{t('queue.attachments', { count: item.attachments.length })}</span> : null}
                </p>
              )}
              <div className="flex shrink-0 items-center gap-0.5">
                {editing === item.id ? (
                  <>
                    <Button variant="ghost" size="icon" className="size-7" aria-label={t('queue.save')} disabled={sending || !draft.trim()} onClick={() => { app.editQueued(item.id, draft); setEditing(null) }}><Check className="size-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="size-7" aria-label={t('queue.cancel')} disabled={sending} onClick={() => setEditing(null)}><X className="size-3.5" /></Button>
                  </>
                ) : (
                  <>
                    {app.busy && !item.loop ? (
                      <Button
                        variant="default"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        disabled={sending || pending || steeringId !== null}
                        title={pending ? t('queue.waitSession') : t('queue.steerHint')}
                        aria-label={t('queue.steer')}
                        onClick={() => {
                          setSteeringId(item.id)
                          void app.steerQueued(item.id).finally(() => setSteeringId(current => current === item.id ? null : current))
                        }}
                      >
                        {steeringId === item.id ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden="true" /> : <CornerDownRight className="size-3.5" aria-hidden="true" />}
                        {t('queue.steer')}
                      </Button>
                    ) : null}
                    <Button variant="outline" size="sm" className="h-8 px-2 text-xs" disabled={sending || pending} title={pending ? t('queue.waitSession') : app.busy ? t('queue.sendNowInterrupt') : t('queue.sendNow')} onClick={() => { void app.sendQueuedNow(item.id) }}>
                      {app.sendingQueued === item.id ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden="true" /> : <Send className="size-3.5" aria-hidden="true" />}
                      {app.sendingQueued === item.id ? t('queue.sending') : t('queue.sendNow')}
                    </Button>
                    <Button variant="ghost" size="icon" className="size-7" aria-label={t('queue.edit')} disabled={sending || steeringId === item.id} onClick={() => { setEditing(item.id); setDraft(item.prompt) }}><Pencil className="size-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="size-7" aria-label={t('queue.remove')} disabled={sending || steeringId === item.id} onClick={() => app.removeQueued(item.id)}><Trash2 className="size-3.5" /></Button>
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
