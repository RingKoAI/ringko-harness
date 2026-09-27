import { ChevronRight, CornerLeftUp, Folder, FolderPlus, Pencil } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { createDirectory, listDirectory, type DirectoryListing } from '@/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

export interface DirectoryBrowserProps {
  open: boolean
  onOpen(path: string): void
  onClose(): void
}

export function DirectoryBrowser({ open, onOpen, onClose }: DirectoryBrowserProps) {
  const { t } = useI18n()
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [folder, setFolder] = useState<string | null>(null)

  const navigate = useCallback((path?: string) => {
    setLoading(true)
    setError(null)
    listDirectory(path)
      .then((next) => {
        setListing(next)
        setDraft(next.path)
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!open) return
    setEditing(false)
    setShowHidden(false)
    setFolder(null)
    navigate()
  }, [open, navigate])

  async function makeFolder(): Promise<void> {
    const name = (folder ?? '').trim()
    if (!listing || name.length === 0) return
    try {
      const created = await createDirectory(listing.path, name)
      setFolder(null)
      navigate(created)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const entries = (listing?.entries ?? []).filter((entry) => showHidden || !entry.hidden)

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="flex h-[500px] w-[680px] max-w-[95vw] flex-col gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="text-sm">{t('browser.title')}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-1 border-b px-2 py-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            title={t('browser.up')}
            onClick={() => {
              const parent = listing?.crumbs.at(-2)?.path
              if (parent) navigate(parent)
            }}
          >
            <CornerLeftUp className="size-3.5" />
          </Button>
          {editing ? (
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  setEditing(false)
                  navigate(draft)
                }
                if (event.key === 'Escape') setEditing(false)
              }}
              className="h-7 flex-1 font-mono text-xs"
              autoFocus
            />
          ) : (
            <div className="flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap">
              {(listing?.crumbs ?? []).map((crumb, index) => (
                <span key={crumb.path} className="flex items-center">
                  <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                  <button
                    type="button"
                    className={cn(
                      'rounded px-1.5 py-0.5 text-xs hover:bg-accent',
                      index === (listing?.crumbs.length ?? 0) - 1 && 'font-medium text-foreground',
                    )}
                    onClick={() => navigate(crumb.path)}
                  >
                    {index === 0 ? t('browser.home') : crumb.name}
                  </button>
                </span>
              ))}
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            title={t('browser.editPath')}
            onClick={() => {
              setDraft(listing?.path ?? '')
              setEditing((value) => !value)
            }}
          >
            <Pencil className="size-3.5" />
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2">
            {loading ? (
              <p className="px-2 py-4 text-xs text-muted-foreground">{t('browser.loading')}</p>
            ) : error ? (
              <p className="px-2 py-4 text-xs text-destructive">{error}</p>
            ) : entries.length === 0 ? (
              <p className="px-2 py-4 text-xs text-muted-foreground">{t('browser.empty')}</p>
            ) : (
              entries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => navigate(entry.path)}
                >
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{entry.name}</span>
                </button>
              ))
            )}
            {listing?.truncated ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">…</p>
            ) : null}
          </div>
        </ScrollArea>

        {folder !== null ? (
          <div className="flex items-center gap-2 border-t px-3 py-2">
            <Input
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void makeFolder()
                if (event.key === 'Escape') setFolder(null)
              }}
              placeholder={t('browser.folderName')}
              className="h-8 flex-1 text-xs"
              autoFocus
            />
            <Button size="sm" onClick={() => void makeFolder()}>
              {t('common.save')}
            </Button>
          </div>
        ) : null}

        <DialogFooter className="flex-row items-center gap-2 border-t px-3 py-3 sm:justify-between">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={!listing} onClick={() => setFolder('')}>
              <FolderPlus data-icon="inline-start" />
              {t('browser.newFolder')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowHidden((value) => !value)}>
              {t('browser.showHidden')}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              {t('browser.cancel')}
            </Button>
            <Button size="sm" disabled={!listing} onClick={() => { if (listing) onOpen(listing.path) }}>
              {t('browser.open')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
