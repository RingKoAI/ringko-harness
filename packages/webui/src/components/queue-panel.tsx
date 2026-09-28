import { useState } from 'react'
import { ListOrdered, Pencil, Play, Trash2, Check, X } from 'lucide-react'
import { useApp } from '@/store'
import { useI18n } from '@/i18n'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'

export function QueuePanel() {
  const app = useApp(); const { t } = useI18n()
  const [editing, setEditing] = useState<string | null>(null); const [draft, setDraft] = useState('')
  if (!app.queue.length) return null
  return <section aria-label={t('queue.title')} className="mx-auto mb-3 max-w-3xl rounded-lg border p-3">
    <div className="flex items-center gap-2 text-sm"><ListOrdered className="size-4" /><span className="flex-1">{t('queue.title')} · {app.queue.length}</span>{!app.busy ? <Button size="sm" variant="outline" onClick={app.resumeQueue}><Play />{t('queue.resume')}</Button> : null}</div>
    <p className="mt-1 text-xs text-muted-foreground">{t('queue.hint')}</p>
    <ol className="mt-2 max-h-48 space-y-2 overflow-auto">{app.queue.map(item => <li key={item.id} className="flex items-start gap-2 border-t pt-2">
      {editing === item.id ? <Textarea aria-label={t('queue.edit')} value={draft} onChange={event => setDraft(event.target.value)} maxLength={65536} /> : <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm">{item.prompt}{item.attachments.length ? <span className="block text-xs text-muted-foreground">{t('queue.attachments', { count: item.attachments.length })}</span> : null}</p>}
      {editing === item.id ? <><Button variant="ghost" size="icon" aria-label={t('queue.save')} disabled={!draft.trim()} onClick={() => { app.editQueued(item.id, draft); setEditing(null) }}><Check /></Button><Button variant="ghost" size="icon" aria-label={t('queue.cancel')} onClick={() => setEditing(null)}><X /></Button></> : <><Button variant="ghost" size="icon" aria-label={t('queue.edit')} onClick={() => { setEditing(item.id); setDraft(item.prompt) }}><Pencil /></Button><Button variant="ghost" size="icon" aria-label={t('queue.remove')} onClick={() => app.removeQueued(item.id)}><Trash2 /></Button></>}
    </li>)}</ol>
  </section>
}
