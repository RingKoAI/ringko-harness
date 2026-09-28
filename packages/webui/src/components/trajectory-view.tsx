import { Activity, Bot, Copy, GitBranch, MessageSquare, RefreshCw, Settings, Shrink, Wrench } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { TrajectoryKind } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TRAJECTORY_WINDOW_LIMIT, useTrajectory } from '@/hooks/use-trajectory'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

const KINDS: TrajectoryKind[] = ['user', 'model', 'assistant', 'tool', 'task', 'compaction', 'session']
const ICONS = { user: MessageSquare, model: Activity, assistant: Bot, tool: Wrench, task: GitBranch, compaction: Shrink, session: Settings }
const TIMELINE_LIMIT = 100

export function TrajectoryView({ sessionId }: { sessionId?: string }) {
  const { t, locale } = useI18n()
  const data = useTrajectory(sessionId)
  const [kind, setKind] = useState<TrajectoryKind | 'all'>('all')
  const [query, setQuery] = useState('')
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null)
  const rowElements = useRef(new Map<number, HTMLButtonElement>())
  const followTail = useRef(true)
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase()
    return data.records.filter(record => (kind === 'all' || record.kind === kind)
      && (!search || `${record.seq} ${record.type} ${record.label} ${record.preview}`.toLowerCase().includes(search)))
  }, [data.records, kind, query])
  const selected = filtered.find(record => record.seq === selectedSeq) ?? filtered.at(-1)
  const timeline = filtered.slice(-TIMELINE_LIMIT)
  const time = (value: number) => new Date(value).toLocaleString(locale)
  useEffect(() => {
    if (selectedSeq === null && followTail.current) {
      const last = filtered.at(-1)
      if (last) rowElements.current.get(last.seq)?.scrollIntoView({ block: 'nearest' })
    }
  }, [filtered, selectedSeq])

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={t('trajectory.title')}>
      <div className="space-y-3 border-b p-3 sm:p-4">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="text-sm font-semibold">{t('trajectory.title')}</h2><p className="text-xs text-muted-foreground">{t('trajectory.description')}</p></div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => { followTail.current = true; setSelectedSeq(null); const last = filtered.at(-1); if (last) rowElements.current.get(last.seq)?.scrollIntoView({ block: 'nearest' }) }}>{t('trajectory.latest')}</Button>
            <Button variant="ghost" size="icon" onClick={data.refresh} disabled={!sessionId} title={t('toolLog.refresh')} aria-label={t('toolLog.refresh')}><RefreshCw /></Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {(['all', ...KINDS] as const).map(value => <Button key={value} size="sm" variant={kind === value ? 'secondary' : 'ghost'} onClick={() => setKind(value)}>{t(`trajectory.${value}`)}</Button>)}
        </div>
        <Input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('trajectory.search')} aria-label={t('trajectory.search')} />
        {timeline.length > 0 ? (
          <div>
            <p className="mb-1 text-xs text-muted-foreground">{t('trajectory.timeline', { count: timeline.length })}</p>
            <div className="flex gap-0.5 overflow-x-auto py-1" aria-label={t('trajectory.timelineLabel')}>
              {timeline.map(record => (
                <button key={record.seq} type="button" aria-pressed={selected?.seq === record.seq}
                  aria-label={`#${record.seq} ${record.label} ${time(record.time)}`}
                  title={`#${record.seq} · ${record.type} · ${time(record.time)}`}
                  className={cn('h-6 min-w-2 flex-1 rounded-sm bg-muted-foreground/25 hover:bg-primary/60 focus-visible:outline-2 focus-visible:outline-ring', record.failed && 'bg-destructive/60', selected?.seq === record.seq && 'bg-primary')}
                  onClick={() => { setSelectedSeq(record.seq); rowElements.current.get(record.seq)?.scrollIntoView({ block: 'nearest' }) }} />
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {data.error ? <p role="alert" className="px-4 py-2 text-xs text-destructive">{t('trajectory.loadFailed')}</p> : null}
      {!sessionId ? <p className="p-6 text-sm text-muted-foreground">{t('toolLog.noSession')}</p> : !data.ready && !data.error ? <p role="status" className="p-6 text-sm text-muted-foreground">{t('toolLog.loading')}</p> : null}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <ScrollArea className="min-h-0 flex-1" onScrollCapture={event => {
          const target = event.target as HTMLElement
          followTail.current = target.scrollHeight - target.scrollTop - target.clientHeight < 40
        }}>
          <div className="space-y-1 p-3">
            {data.hasOlder && data.records.length < TRAJECTORY_WINDOW_LIMIT ? <Button variant="outline" className="mb-2 w-full" disabled={data.loadingOlder} onClick={() => void data.loadOlder()}>{data.loadingOlder ? t('toolLog.loading') : t('trajectory.older')}</Button> : null}
            {data.records.length >= TRAJECTORY_WINDOW_LIMIT ? <p className="p-2 text-xs text-muted-foreground">{t('trajectory.windowLimit', { count: TRAJECTORY_WINDOW_LIMIT })}</p> : null}
            {data.ready && filtered.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{t('trajectory.empty')}</p> : null}
            {filtered.map(record => {
              const Icon = ICONS[record.kind]
              return (
                <button key={record.seq} type="button" ref={node => { if (node) rowElements.current.set(record.seq, node); else rowElements.current.delete(record.seq) }} onClick={() => setSelectedSeq(record.seq)} aria-pressed={selected?.seq === record.seq}
                  className={cn('flex w-full items-start gap-2 rounded-lg border border-transparent p-2 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring', selected?.seq === record.seq && 'border-border bg-muted/50')}>
                  <Icon className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground', record.failed && 'text-destructive')} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2"><span className="text-sm font-medium">{record.label}</span><span className="font-mono text-[11px] text-muted-foreground">#{record.seq} · {record.type}</span>{record.failed ? <span className="text-xs text-destructive">{t('toolLog.error')}</span> : null}</div>
                    <p className="truncate text-xs text-muted-foreground">{record.preview}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{time(record.time)}{record.durationMs !== null ? ` · ${record.durationMs} ms` : ''}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </ScrollArea>
        {selected ? (
          <div className="flex max-h-[45vh] min-h-0 flex-col border-t md:max-h-none md:w-[42%] md:border-t-0 md:border-l">
            <div className="flex items-center justify-between gap-2 border-b p-3"><h3 className="truncate text-sm font-medium">#{selected.seq} · {selected.label}</h3>
              <Button size="icon" variant="ghost" title={t('trajectory.copy')} aria-label={t('trajectory.copy')} onClick={() => { void navigator.clipboard.writeText(selected.details).then(() => toast.success(t('trajectory.copied'))).catch(() => toast.error(t('trajectory.copyFailed'))) }}><Copy /></Button>
            </div>
            <ScrollArea className="min-h-0 flex-1 p-3">
              <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs"><dt className="text-muted-foreground">{t('trajectory.type')}</dt><dd className="break-all font-mono">{selected.type}</dd><dt className="text-muted-foreground">{t('trajectory.time')}</dt><dd>{time(selected.time)}</dd>{selected.turn !== null ? <><dt className="text-muted-foreground">{t('toolLog.turn')}</dt><dd>{selected.turn}</dd></> : null}{selected.durationMs !== null ? <><dt className="text-muted-foreground">{t('toolLog.duration')}</dt><dd>{selected.durationMs} ms</dd></> : null}</dl>
              <h4 className="mb-2 text-xs font-medium">{t('trajectory.data')}</h4>
              {selected.truncated ? <p className="mb-2 text-xs text-muted-foreground">{t('trajectory.truncated')}</p> : null}
              <pre className="rounded-md bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap break-words">{selected.details}</pre>
            </ScrollArea>
          </div>
        ) : null}
      </div>
    </section>
  )
}
