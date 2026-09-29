import { useEffect, useState } from 'react'
import { ArrowUp, File, Folder, PanelRight, RefreshCw, Terminal } from 'lucide-react'
import { fetchWorkspaceDiff, fetchWorkspaceFile, fetchWorkspaceFiles, type WorkspaceEntry } from '@/api'
import { useI18n } from '@/i18n'
import { useApp } from '@/store'
import { Button } from './ui/button'
import { TerminalPanel } from './terminal-panel'

export type RightSidebarTab = 'files' | 'terminal'

export function RightSidebar({
  tab,
  onTabChange,
  onClose,
  open,
}: {
  tab: RightSidebarTab
  onTabChange(tab: RightSidebarTab): void
  onClose(): void
  open: boolean
}) {
  const { t } = useI18n()
  const [path, setPath] = useState('')
  const [listing, setListing] = useState<{ path: string; entries: WorkspaceEntry[]; error: string }>({
    path: '',
    entries: [],
    error: '',
  })
  const [selected, setSelected] = useState<string | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const [revision, setRevision] = useState(0)
  const [terminalStarted, setTerminalStarted] = useState(false)
  const [preview, setPreview] = useState<{ key: string; content: string; error: string; notice: string } | null>(null)
  const app = useApp()
  const previewKey = `${showDiff ? 'diff' : 'file'}/${selected ?? ''}/${revision}`
  const listingIsCurrent = listing.path === path
  const entries = listingIsCurrent ? listing.entries : []
  const listingError = listingIsCurrent ? listing.error : ''
  const previewIsCurrent = preview?.key === previewKey
  const currentPreview = previewIsCurrent ? preview : null
  const loading = (Boolean(selected) || showDiff) && !previewIsCurrent

  useEffect(() => {
    let active = true
    fetchWorkspaceFiles(path)
      .then((page) => {
        if (active) setListing({ path, entries: page.entries, error: '' })
      })
      .catch((cause: unknown) => {
        if (active) setListing({ path, entries: [], error: cause instanceof Error ? cause.message : String(cause) })
      })
    return () => {
      active = false
    }
  }, [path, revision])

  useEffect(() => {
    if (!selected && !showDiff) return
    let active = true
    const request = showDiff ? fetchWorkspaceDiff(selected ?? '') : fetchWorkspaceFile(selected!)
    request
      .then((result) => {
        if (!active) return
        setPreview({
          key: previewKey,
          content: result.content,
          error: '',
          notice: 'binary' in result && result.binary
            ? t('workspace.binary')
            : 'truncated' in result && result.truncated
              ? t('workspace.truncated')
              : '',
        })
      })
      .catch((cause: unknown) => {
        if (active) setPreview({ key: previewKey, content: '', error: cause instanceof Error ? cause.message : String(cause), notice: '' })
      })
    return () => {
      active = false
    }
  }, [selected, showDiff, revision, t, previewKey])

  function openEntry(entry: WorkspaceEntry): void {
    setSelected(entry.directory ? null : entry.path)
    setShowDiff(false)
    if (entry.directory) setPath(entry.path)
  }

  return (
    <aside className={`${open ? 'flex' : 'hidden'} h-svh w-80 shrink-0 flex-col border-l bg-sidebar text-sidebar-foreground`} aria-label={t('rightSidebar.title')}>
      <header className="flex h-14 shrink-0 items-center gap-1 border-b px-3">
        <Button
          variant={tab === 'files' ? 'secondary' : 'ghost'}
          size="sm"
          aria-pressed={tab === 'files'}
          onClick={() => onTabChange('files')}
        >
          <Folder />
          {t('rightSidebar.files')}
        </Button>
        <Button
          variant={tab === 'terminal' ? 'secondary' : 'ghost'}
          size="sm"
          aria-pressed={tab === 'terminal'}
          onClick={() => {
            setTerminalStarted(true)
            onTabChange('terminal')
          }}
        >
          <Terminal />
          {t('rightSidebar.terminal')}
        </Button>
        <Button
          className="ml-auto"
          variant="ghost"
          size="icon"
          aria-label={t('rightSidebar.close')}
          title={t('rightSidebar.close')}
          onClick={onClose}
        >
          <PanelRight />
        </Button>
      </header>

      {tab === 'files' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-1 border-b p-2">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t('workspace.up')}
              title={t('workspace.up')}
              disabled={!path}
              onClick={() => {
                setPath(path.split(/[\\/]/).slice(0, -1).join('/'))
                setSelected(null)
                setShowDiff(false)
              }}
            >
              <ArrowUp />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t('workspace.refresh')}
              title={t('workspace.refresh')}
              onClick={() => setRevision((value) => value + 1)}
            >
              <RefreshCw />
            </Button>
            <Button
              size="sm"
              variant={showDiff ? 'secondary' : 'ghost'}
              className="ml-auto"
              onClick={() => {
                setSelected(null)
                setShowDiff(true)
              }}
            >
              {t('workspace.diff')}
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <p className="truncate border-b px-3 py-2 text-xs text-muted-foreground" title={app.info?.workspace}>
              {app.info?.workspace ?? t('workspace.scope')}
              {path ? ` / ${path}` : ''}
            </p>
            {listingError ? <p role="alert" className="p-3 text-xs text-destructive">{listingError}</p> : null}
            {!listingError && listingIsCurrent && entries.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">{t('browser.empty')}</p>
            ) : null}
            {!listingError && !listingIsCurrent ? (
              <p className="p-3 text-xs text-muted-foreground">{t('workspace.loading')}</p>
            ) : null}
            {entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className="flex min-h-9 w-full items-center gap-2 px-3 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => openEntry(entry)}
              >
                {entry.directory ? <Folder className="size-4 shrink-0 text-muted-foreground" /> : <File className="size-4 shrink-0 text-muted-foreground" />}
                <span className="truncate">{entry.name}</span>
              </button>
            ))}
          </div>
          <section className="flex min-h-0 max-h-[45%] shrink-0 flex-col border-t">
            <div className="flex h-9 shrink-0 items-center border-b px-3 text-xs font-medium">
              <span className="truncate">{showDiff ? t('workspace.diff') : selected ?? t('workspace.file')}</span>
            </div>
            {currentPreview?.error ? <p role="alert" className="overflow-auto p-3 text-xs text-destructive">{currentPreview.error}</p> : null}
            {currentPreview?.notice ? <p className="shrink-0 p-2 text-xs text-muted-foreground">{currentPreview.notice}</p> : null}
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5">
              {loading ? t('workspace.loading') : currentPreview?.content || t('workspace.empty')}
            </pre>
          </section>
        </div>
      ) : null}
      <div className={tab === 'terminal' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        <TerminalPanel enabled={terminalStarted} />
      </div>
    </aside>
  )
}
