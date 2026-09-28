import { AlertCircle, CheckCircle2, CircleDashed, RefreshCw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { fetchToolLog, type ToolLogEntry, type ToolLogPage } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useI18n } from '@/i18n'

function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? 'null'
}

const EMPTY_PAGE: ToolLogPage = { entries: [], total: 0 }

function ToolLogRow({ entry, busy }: { entry: ToolLogEntry; busy: boolean }) {
  const { locale, t } = useI18n()
  const status = entry.status === 'success'
    ? t('toolLog.success')
    : entry.status === 'error'
      ? t('toolLog.error')
      : busy && entry.startedAt !== null ? t('toolLog.running') : t('toolLog.noResult')
  const StatusIcon = entry.status === 'success' ? CheckCircle2 : entry.status === 'error' ? AlertCircle : CircleDashed
  const duration = entry.startedAt !== null && entry.completedAt !== null
    ? Math.max(0, entry.completedAt - entry.startedAt)
    : null
  return (
    <details className="group rounded-xl border bg-card open:shadow-sm">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-3 py-2 marker:hidden hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <StatusIcon className={entry.status === 'error' ? 'size-4 shrink-0 text-destructive' : 'size-4 shrink-0 text-muted-foreground'} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium">{entry.name}</span>
        <Badge variant={entry.status === 'error' ? 'destructive' : 'secondary'}>{status}</Badge>
      </summary>
      <div className="space-y-3 border-t px-3 py-3 text-xs">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
          <dt>{t('toolLog.callId')}</dt><dd className="break-all font-mono text-foreground">{entry.callId}</dd>
          {entry.turn !== null ? <><dt>{t('toolLog.turn')}</dt><dd className="text-foreground">{entry.turn}</dd></> : null}
          <dt>{t('toolLog.requested')}</dt><dd className="text-foreground">{new Date(entry.requestedAt).toLocaleString(locale)}</dd>
          {entry.startedAt !== null ? <><dt>{t('toolLog.started')}</dt><dd className="text-foreground">{new Date(entry.startedAt).toLocaleString(locale)}</dd></> : null}
          {entry.completedAt !== null ? <><dt>{t('toolLog.completed')}</dt><dd className="text-foreground">{new Date(entry.completedAt).toLocaleString(locale)}</dd></> : null}
          {duration !== null ? <><dt>{t('toolLog.duration')}</dt><dd className="text-foreground">{duration} ms</dd></> : null}
        </dl>
        <div>
          <p className="mb-1 font-medium">{t('message.arguments')}</p>
          <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-2 font-mono whitespace-pre-wrap break-words">{jsonText(entry.arguments)}</pre>
        </div>
        {entry.result !== null ? (
          <div>
            <p className="mb-1 font-medium">{t('message.output')}</p>
            <pre className="max-h-80 overflow-auto rounded-md bg-muted/50 p-2 font-mono whitespace-pre-wrap break-words">{entry.result}</pre>
          </div>
        ) : null}
      </div>
    </details>
  )
}

export function ToolLogSheet({ open, onOpenChange, sessionId, busy }: {
  open: boolean
  onOpenChange(open: boolean): void
  sessionId?: string
  busy: boolean
}) {
  const { t } = useI18n()
  const [result, setResult] = useState<{ key: string; page: ToolLogPage; error: boolean } | null>(null)
  const [loadingMoreFor, setLoadingMoreFor] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const requestVersion = useRef(0)
  const queryKey = open && sessionId ? `${sessionId}:${busy}:${refreshKey}` : null
  const page = result?.key === queryKey ? result.page : EMPTY_PAGE
  const loading = queryKey !== null && result?.key !== queryKey
  const loadingMore = queryKey !== null && loadingMoreFor === queryKey
  const error = result?.key === queryKey && result.error

  useEffect(() => {
    const version = ++requestVersion.current
    if (!queryKey || !sessionId) return
    fetchToolLog(sessionId)
      .then((next) => {
        if (requestVersion.current === version) setResult({ key: queryKey, page: next, error: false })
      })
      .catch(() => {
        if (requestVersion.current === version) setResult({ key: queryKey, page: EMPTY_PAGE, error: true })
      })
    return () => { requestVersion.current += 1 }
  }, [queryKey, sessionId])

  async function loadMore(): Promise<void> {
    if (!sessionId || !queryKey || loadingMore || page.entries.length >= page.total) return
    const version = requestVersion.current
    setLoadingMoreFor(queryKey)
    try {
      const next = await fetchToolLog(sessionId, page.entries.length)
      if (requestVersion.current === version) {
        setResult((current) => current?.key === queryKey ? {
          key: queryKey,
          error: false,
          page: {
            total: next.total,
            entries: [...current.page.entries, ...next.entries.filter((entry) => !current.page.entries.some((item) => item.id === entry.id))],
          },
        } : current)
      }
    } catch {
      if (requestVersion.current === version) {
        setResult((current) => current?.key === queryKey ? { ...current, error: true } : current)
      }
    } finally {
      setLoadingMoreFor((current) => current === queryKey ? null : current)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl" showCloseButton={false}>
        <SheetHeader className="flex-row items-start justify-between gap-3 border-b">
          <div className="min-w-0 space-y-1">
            <SheetTitle>{t('toolLog.title')}</SheetTitle>
            <SheetDescription>{t('toolLog.description')}</SheetDescription>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" title={t('toolLog.refresh')} aria-label={t('toolLog.refresh')} disabled={!sessionId || loading} onClick={() => setRefreshKey((value) => value + 1)}><RefreshCw /></Button>
            <Button variant="ghost" size="icon" title={t('toolLog.close')} aria-label={t('toolLog.close')} onClick={() => onOpenChange(false)}><X /></Button>
          </div>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1 px-4 pb-4">
          {!sessionId ? <p className="py-8 text-center text-sm text-muted-foreground">{t('toolLog.noSession')}</p> : null}
          {loading ? <p className="py-8 text-center text-sm text-muted-foreground" role="status">{t('toolLog.loading')}</p> : null}
          {error ? <p className="py-3 text-sm text-destructive" role="alert">{t('toolLog.loadFailed')}</p> : null}
          {!loading && !error && sessionId && page.entries.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">{t('toolLog.empty')}</p> : null}
          <div className="space-y-2 pt-3">
            {page.entries.map((entry) => <ToolLogRow key={entry.id} entry={entry} busy={busy} />)}
          </div>
          {page.entries.length < page.total ? (
            <Button variant="outline" className="mt-4 w-full" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? t('toolLog.loading') : t('toolLog.loadMore')}
            </Button>
          ) : null}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
