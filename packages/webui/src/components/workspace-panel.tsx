import { useEffect, useState } from 'react'
import { ArrowUp, File, Folder, RefreshCw } from 'lucide-react'
import { fetchWorkspaceFiles, fetchWorkspaceFile, fetchWorkspaceDiff, type WorkspaceEntry } from '@/api'
import { useI18n } from '@/i18n'
import { Button } from './ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from './ui/sheet'

export function WorkspacePanel({ onClose }: { onClose(): void }) {
  const { t } = useI18n(); const [path, setPath] = useState(''); const [entries, setEntries] = useState<WorkspaceEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null); const [view, setView] = useState<'file' | 'diff'>('file')
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [revision, setRevision] = useState(0)
  const previewKey = `${view}/${selected ?? ''}/${revision}`
  const [preview, setPreview] = useState({ key: '', content: '', error: '', notice: '' })
  const loading = !(view === 'file' && selected === null) && preview.key !== previewKey
  const content = preview.key === previewKey ? preview.content : ''
  useEffect(() => {
    let active = true
    fetchWorkspaceFiles(path).then(page => { if (active) { setEntries(page.entries); setNotice(page.truncated ? t('workspace.truncated') : '') } }).catch(cause => { if (active) setError(String(cause)) })
    return () => { active = false }
  }, [path, revision, t])
  useEffect(() => {
    let active = true
    if (view === 'file' && selected === null) return
    const load = view === 'diff' ? fetchWorkspaceDiff(selected ?? '') : fetchWorkspaceFile(selected!)
    load.then(result => { if (active) setPreview({ key: previewKey, content: result.content, error: '', notice: 'binary' in result && result.binary ? t('workspace.binary') : 'truncated' in result && result.truncated ? t('workspace.truncated') : '' }) }).catch(cause => { if (active) setPreview({ key: previewKey, content: '', error: cause instanceof Error ? cause.message : String(cause), notice: '' }) })
    return () => { active = false }
  }, [selected, view, revision, t, previewKey])
  return <Sheet open onOpenChange={open => { if (!open) onClose() }}><SheetContent className="w-full! sm:max-w-5xl!">
    <SheetHeader><SheetTitle>{t('workspace.title')}</SheetTitle><SheetDescription>{t('workspace.scope')}</SheetDescription></SheetHeader>
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4 md:flex-row">
      <aside className="flex max-h-56 shrink-0 flex-col gap-2 md:max-h-none md:w-56">
        <div className="flex items-center gap-1"><Button size="icon" variant="outline" aria-label={t('workspace.up')} disabled={!path} onClick={() => { setPath(path.split('/').slice(0, -1).join('/')); setSelected(null) }}><ArrowUp /></Button><Button size="icon" variant="outline" aria-label={t('workspace.refresh')} onClick={() => setRevision(value => value + 1)}><RefreshCw /></Button><Button size="sm" variant="outline" onClick={() => { setSelected(null); setView('diff') }}>{t('workspace.allChanges')}</Button></div>
        <p className="break-all text-xs text-muted-foreground">/{path}</p>
        <div className="min-h-0 overflow-auto">{entries.map(entry => <button key={entry.path} type="button" className="flex min-h-10 w-full items-center gap-2 rounded px-2 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring" onClick={() => { if (entry.directory) { setPath(entry.path); setSelected(null) } else { setSelected(entry.path); setView('file') } }}>{entry.directory ? <Folder className="size-4 shrink-0" /> : <File className="size-4 shrink-0" />}<span className="truncate">{entry.name}</span></button>)}</div>
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border">
        <div className="flex flex-wrap items-center gap-2 border-b p-2"><span className="min-w-0 flex-1 break-all text-xs">{selected ?? t('workspace.allChanges')}</span><Button size="sm" variant={view === 'file' ? 'secondary' : 'ghost'} disabled={!selected} onClick={() => setView('file')}>{t('workspace.file')}</Button><Button size="sm" variant={view === 'diff' ? 'secondary' : 'ghost'} onClick={() => setView('diff')}>{t('workspace.diff')}</Button></div>
        {error || (!loading && preview.error) ? <p role="alert" className="p-3 text-sm text-destructive">{error || preview.error}</p> : null}{notice || (!loading && preview.notice) ? <p className="p-3 text-sm text-muted-foreground">{notice || preview.notice}</p> : null}
        <pre className="min-h-0 flex-1 overflow-auto p-3 text-xs leading-5">{loading ? t('workspace.loading') : content || t('workspace.empty')}</pre>
      </section>
    </div>
  </SheetContent></Sheet>
}
