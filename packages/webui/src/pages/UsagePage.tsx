import { Activity, ArrowDownToLine, ArrowUpFromLine, Database, Gauge, RefreshCw } from 'lucide-react'
import { BackendError } from '@ringko-ai/client'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { fetchUsageStatistics, type UsageCallKind, type UsageStatistics, type UsageStatisticsBucket, type UsageStatisticsQuery } from '@/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { UsageTrend } from '@/components/usage-trend'
import { useI18n } from '@/i18n'
import { localDateInput, usageRange, USAGE_PAGE_SIZE, USAGE_REFRESH_MS, type UsageRange } from '@/lib/usage-statistics'
import { useApp } from '@/store'

const SELECT_CLASS = 'h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm'
const CALL_KINDS: UsageCallKind[] = ['primary', 'task', 'compaction', 'metadata', 'unknown']

function Metric({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return <div className="min-w-0 rounded-lg border bg-muted/20 p-3"><div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">{icon}<span>{label}</span></div><div className="break-all text-xl font-semibold tabular-nums">{value}</div></div>
}

export function UsagePage() {
  const app = useApp()
  return <UsageDashboard key={JSON.stringify([app.info?.workspace, app.sessionId])} />
}

function UsageDashboard() {
  const { t, locale } = useI18n()
  const app = useApp()
  const workspace = app.info?.workspace
  const [range, setRange] = useState<UsageRange>('7d')
  const [from, setFrom] = useState(localDateInput)
  const [to, setTo] = useState(localDateInput)
  const [scope, setScope] = useState<'workspace' | 'session'>('workspace')
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [kind, setKind] = useState<UsageCallKind | ''>('')
  const [offset, setOffset] = useState(0)
  const [tab, setTab] = useState<'requests' | 'providers' | 'models'>('requests')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const [result, setResult] = useState<{ key: string; data: UsageStatistics } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])
  const key = JSON.stringify([workspace, range, from, to, scope, app.sessionId, provider, model, kind, offset])
  const data = result?.key === key && result.data.workspace === workspace ? result.data : null
  const validRange = usageRange(range, from, to) !== null
  const noSession = scope === 'session' && !app.sessionId
  const number = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat(locale).format(value)
  const percent = (value: number | null | undefined) => value == null ? t('usage.unavailable') : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value)
  const milliseconds = (value: number | null | undefined) => value == null ? '—' : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value / 1000)} s`
  const change = (action: () => void) => { setOffset(0); action() }

  useEffect(() => {
    if (!workspace || !validRange || noSession) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      setLoading(true)
      setError(null)
      const dates = usageRange(range, from, to)
      if (!dates) return
      const query: UsageStatisticsQuery = { ...dates, timeZone, offset, limit: USAGE_PAGE_SIZE,
        ...(provider ? { provider } : {}), ...(model ? { model } : {}), ...(kind ? { kind } : {}),
        ...(scope === 'session' ? { sessionId: app.sessionId } : {}),
      }
      try {
        const response = await fetchUsageStatistics(query, controller.signal)
        if (!controller.signal.aborted) { setResult({ key, data: response }); setError(null) }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof BackendError && cause.status === 404 ? t('usage.restartBackend') : cause instanceof Error ? cause.message : t('usage.loadFailed'))
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
          if (autoRefresh) timer = setTimeout(() => void load(), USAGE_REFRESH_MS)
        }
      }
    }
    timer = setTimeout(() => void load(), 0)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [key, refresh, autoRefresh, workspace, validRange, noSession, range, from, to, scope, app.sessionId, provider, model, kind, offset, timeZone, t])

  // A newly reported model call also updates an open statistics page.
  useEffect(() => {
    if (!autoRefresh) return
    const timer = setTimeout(() => setRefresh(value => value + 1), 2200)
    return () => clearTimeout(timer)
  }, [app.usage, autoRefresh])

  const providerOptions = new Set(data?.options.providers ?? [])
  if (provider) providerOptions.add(provider)
  const modelOptions = new Set(data?.options.models ?? [])
  if (model) modelOptions.add(model)
  const summary = data?.summary
  const breakdown = (rows: UsageStatisticsBucket[]) => <div className="overflow-x-auto"><table className="w-full min-w-[35rem] text-left text-xs">
    <thead className="border-b text-muted-foreground"><tr>{[t(tab === 'providers' ? 'usage.provider' : 'usage.model'), t('usage.requests'), 'Tokens', t('usage.cacheHit'), t('usage.latency')].map(label => <th key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr></thead>
    <tbody>{rows.map(row => <tr key={row.key} className="border-b last:border-0"><td className="max-w-60 break-all px-3 py-3 font-mono">{row.key || t('usage.unknown')}</td><td className="px-3 py-3 tabular-nums">{number(row.usage?.calls)}</td><td className="px-3 py-3 tabular-nums">{number(row.usage?.totalTokens)}</td><td className="px-3 py-3 tabular-nums">{percent(row.usage?.cacheHitRate)}</td><td className="px-3 py-3 tabular-nums">{milliseconds(row.averageDurationMs)}</td></tr>)}</tbody>
  </table></div>

  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold">{t('settings.usage')}</h2><p className="mt-1 text-sm text-muted-foreground">{t('usage.dashboardDescription')}</p></div>
      <Button size="sm" variant="outline" disabled={loading || !validRange || noSession} onClick={() => setRefresh(value => value + 1)}><RefreshCw className={loading ? 'animate-spin' : undefined} />{t('usage.refresh')}</Button>
    </div>
    <Card className="gap-3">
      <CardContent className="space-y-3">
        <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-3">
          <label className="min-w-0 space-y-1 text-xs text-muted-foreground"><span>{t('usage.range')}</span><select className={SELECT_CLASS} value={range} onChange={event => change(() => setRange(event.target.value as UsageRange))}>{(['today', '7d', '30d', 'all', 'custom'] as const).map(value => <option key={value} value={value}>{t(`usage.range.${value}`)}</option>)}</select></label>
          <label className="min-w-0 space-y-1 text-xs text-muted-foreground"><span>{t('usage.scope')}</span><select className={SELECT_CLASS} value={scope} onChange={event => change(() => setScope(event.target.value as 'workspace' | 'session'))}><option value="workspace">{t('usage.workspace')}</option><option value="session">{t('usage.currentSession')}</option></select></label>
          <label className="min-w-0 space-y-1 text-xs text-muted-foreground"><span>{t('usage.kind')}</span><select className={SELECT_CLASS} value={kind} onChange={event => change(() => setKind(event.target.value as UsageCallKind | ''))}><option value="">{t('usage.allKinds')}</option>{CALL_KINDS.map(value => <option key={value} value={value}>{t(`usage.kind.${value}`)}</option>)}</select></label>
          <label className="min-w-0 space-y-1 text-xs text-muted-foreground"><span>{t('usage.provider')}</span><select className={SELECT_CLASS} value={provider ? `v:${provider}` : ''} onChange={event => change(() => { setProvider(event.target.value.slice(2)); setModel('') })}><option value="">{t('usage.allProviders')}</option>{[...providerOptions].map(value => <option key={value} value={`v:${value}`}>{value}</option>)}</select></label>
          <label className="min-w-0 space-y-1 text-xs text-muted-foreground"><span>{t('usage.model')}</span><select className={SELECT_CLASS} value={model ? `v:${model}` : ''} onChange={event => change(() => setModel(event.target.value.slice(2)))}><option value="">{t('usage.allModels')}</option>{[...modelOptions].map(value => <option key={value} value={`v:${value}`}>{value}</option>)}</select></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={autoRefresh} onChange={event => setAutoRefresh(event.target.checked)} />{t('usage.autoRefresh')}</label>
        </div>
        {range === 'custom' ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="space-y-1 text-xs text-muted-foreground"><span>{t('usage.from')}</span><Input type="date" value={from} max={localDateInput()} onChange={event => change(() => setFrom(event.target.value))} /></label><label className="space-y-1 text-xs text-muted-foreground"><span>{t('usage.to')}</span><Input type="date" value={to} min={from} max={localDateInput()} onChange={event => change(() => setTo(event.target.value))} /></label></div> : null}
        <p className="break-all text-xs text-muted-foreground">{workspace} · {timeZone}</p>
      </CardContent>
    </Card>
    {!validRange ? <p role="alert" className="text-sm text-destructive">{t('usage.invalidRange')}</p> : noSession ? <p className="text-sm text-muted-foreground">{t('usage.selectSession')}</p> : null}
    {error ? <p role="alert" className="break-words text-sm text-destructive">{t('usage.loadFailed')} {error}</p> : null}
    {loading && !data && validRange && !noSession ? <p role="status" className="text-sm text-muted-foreground">{t('usage.loading')}</p> : null}
    {data && validRange && !noSession ? <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric icon={<Activity className="size-4 shrink-0" />} label={t('usage.requests')} value={number(data.total)} />
        <Metric icon={<Database className="size-4 shrink-0" />} label={t('usage.totalTokens')} value={number(summary?.totalTokens)} />
        <Metric icon={<Gauge className="size-4 shrink-0" />} label={t('usage.cacheHit')} value={percent(summary?.cacheHitRate)} />
        <Metric icon={<Activity className="size-4 shrink-0" />} label={t('usage.latency')} value={milliseconds(data.averageDurationMs)} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric icon={<ArrowDownToLine className="size-4 shrink-0" />} label={t('usage.input')} value={number(summary?.inputTokens)} />
        <Metric icon={<ArrowUpFromLine className="size-4 shrink-0" />} label={t('usage.output')} value={number(summary?.outputTokens)} />
        <Metric icon={<Database className="size-4 shrink-0" />} label={t('usage.cacheReadLabel')} value={number(summary?.cacheReadTokens)} />
        <Metric icon={<Database className="size-4 shrink-0" />} label={t('usage.cacheWriteLabel')} value={number(summary?.cacheWriteTokens)} />
      </div>
      <p className="text-xs text-muted-foreground">{t('usage.statisticsCoverage', { sessions: data.sessions, calls: summary?.cacheReportedCalls ?? 0, timed: data.timedCalls })} {t('usage.explanation')}</p>
      {summary?.partial ? <p className="text-xs text-muted-foreground">{t('usage.partialStatistics')}</p> : null}
      {data.coverage.limited || data.coverage.skippedSessions ? <p role="status" className="text-sm text-amber-600 dark:text-amber-400">{t('usage.incomplete', { count: data.coverage.skippedSessions })}</p> : null}
      {data.total ? <UsageTrend data={data} /> : <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t('usage.noRecords')}</p>}
      <Card className="min-w-0 gap-3">
        <CardHeader className="flex flex-wrap gap-1">{(['requests', 'providers', 'models'] as const).map(value => <Button key={value} size="sm" variant={tab === value ? 'secondary' : 'ghost'} aria-pressed={tab === value} onClick={() => setTab(value)}>{t(`usage.tab.${value}`)}</Button>)}</CardHeader>
        <CardContent className="min-w-0">
          {tab === 'requests' ? <>
            <div className="overflow-x-auto"><table className="w-full min-w-[48rem] text-left text-xs">
              <thead className="border-b text-muted-foreground"><tr>{[t('usage.time'), t('usage.model'), t('usage.kind'), t('usage.input'), t('usage.output'), t('usage.cacheReadLabel'), t('usage.duration')].map(label => <th key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr></thead>
              <tbody>{data.requests.map(call => <tr key={call.id} className="border-b align-top last:border-0">
                <td className="whitespace-nowrap px-3 py-3"><div>{new Date(call.time).toLocaleDateString(locale)}</div><div className="mt-1 text-muted-foreground">{new Date(call.time).toLocaleTimeString(locale)}</div></td>
                <td className="max-w-64 px-3 py-3"><div className="break-all font-mono">{call.model ?? t('usage.unknown')}</div><details className="mt-1 text-muted-foreground"><summary className="cursor-pointer truncate">{call.sessionTitle ?? t('usage.sessionDetails')}</summary><div className="mt-2 max-w-56 break-all font-mono">{call.sessionId}<br />{call.id}</div></details></td>
                <td className="px-3 py-3">{t(`usage.kind.${call.kind}`)}</td><td className="px-3 py-3 tabular-nums">{number(call.usage.inputTokens)}</td><td className="px-3 py-3 tabular-nums">{number(call.usage.outputTokens)}</td><td className="px-3 py-3 tabular-nums">{number(call.usage.cacheReadTokens)}</td><td className="px-3 py-3 tabular-nums">{milliseconds(call.durationMs)}</td>
              </tr>)}</tbody>
            </table></div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{t('usage.pagination', { from: data.total ? data.offset + 1 : 0, to: Math.min(data.offset + data.limit, data.total), total: data.total })}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - USAGE_PAGE_SIZE))}>{t('usage.previous')}</Button><Button variant="outline" size="sm" disabled={loading || offset + data.limit >= data.total} onClick={() => setOffset(value => value + USAGE_PAGE_SIZE)}>{t('usage.next')}</Button></div></div>
          </> : breakdown(tab === 'providers' ? data.providers : data.models)}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">{t('usage.sourceNote', { sessions: data.coverage.scannedSessions, missing: data.coverage.unreportedSessions, duplicates: data.coverage.deduplicatedCalls })} · {t('usage.updated', { time: new Date(data.generatedAt).toLocaleTimeString(locale) })}</p>
    </> : null}
  </div>
}
