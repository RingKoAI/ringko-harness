import { FileUp, FlaskConical, KeyRound, LoaderCircle, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { fetchMcp, fetchMcpConnected, fetchOAuthStatus, reload, saveMcp, startMcpOAuth, testMcp, type McpConnected } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'

type Transport = 'stdio' | 'http' | 'sse'

interface ConnRow {
  name: string
  transport: Transport
  command: string
  args: string
  env: string
  url: string
  headers: string
}

const TRANSPORTS: Transport[] = ['stdio', 'http', 'sse']

function emptyRow(): ConnRow {
  return { name: '', transport: 'stdio', command: '', args: '', env: '', url: '', headers: '' }
}

function parseArgs(value: string): string[] {
  const text = value.trim()
  if (text.length === 0) return []
  if (text.startsWith('[')) {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) throw new Error('args must be a JSON array.')
    return parsed.map((item) => String(item))
  }
  return text.split(/\s+/)
}

function parseObject(value: string, label: string): Record<string, string> | undefined {
  if (value.trim().length === 0) return undefined
  const parsed: unknown = JSON.parse(value)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object.`)
  return parsed as Record<string, string>
}

function configToRow(name: string, config: Record<string, unknown>): ConnRow {
  const type = typeof config.type === 'string' ? config.type.toLowerCase() : ''
  const transport: Transport = config.url ? (type === 'sse' ? 'sse' : 'http') : 'stdio'
  return {
    name,
    transport,
    command: typeof config.command === 'string' ? config.command : '',
    args: Array.isArray(config.args) ? config.args.join(' ') : '',
    env: config.env ? JSON.stringify(config.env, null, 2) : '',
    url: typeof config.url === 'string' ? config.url : '',
    headers: config.headers ? JSON.stringify(config.headers, null, 2) : '',
  }
}

function rowToConfig(row: ConnRow): Record<string, unknown> {
  if (row.transport === 'stdio') {
    const config: Record<string, unknown> = { type: 'stdio', command: row.command.trim() }
    const args = parseArgs(row.args)
    if (args.length > 0) config.args = args
    const env = parseObject(row.env, 'env')
    if (env) config.env = env
    return config
  }
  const config: Record<string, unknown> = { type: row.transport, url: row.url.trim() }
  const headers = parseObject(row.headers, 'headers')
  if (headers) config.headers = headers
  return config
}

/** Serialize rows to the wire `{"mcpServers": {…}}` JSON format. */
function rowsToJson(rows: ConnRow[]): string {
  const servers: Record<string, unknown> = {}
  for (const row of rows) {
    const name = row.name.trim()
    if (name.length === 0) continue
    servers[name] = rowToConfig(row)
  }
  return JSON.stringify({ mcpServers: servers }, null, 2)
}

/** Parse `{"mcpServers": {…}}` JSON text into ConnRow[]. Throws on bad input. */
function jsonToRows(text: string): ConnRow[] {
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Root must be a JSON object.')
  }
  const record = parsed as Record<string, unknown>
  const servers = record.mcpServers
  if (servers === undefined || typeof servers !== 'object' || servers === null || Array.isArray(servers)) {
    throw new Error('Missing "mcpServers" object.')
  }
  const rows: ConnRow[] = []
  for (const [name, config] of Object.entries(servers as Record<string, unknown>)) {
    if (typeof config !== 'object' || config === null || Array.isArray(config)) continue
    rows.push(configToRow(name, config as Record<string, unknown>))
  }
  return rows
}

/** Dialog for importing MCP servers from a JSON snippet. */
function ImportDialog({
  open,
  onClose,
  onImport,
}: {
  open: boolean
  onClose: () => void
  onImport: (rows: ConnRow[]) => void
}) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function handleFile(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') setText(reader.result)
    }
    reader.readAsText(file)
    // Reset so re-selecting the same file still fires onChange.
    event.target.value = ''
  }

  function submit(): void {
    const trimmed = text.trim()
    if (trimmed.length === 0) return
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      toast.error(t('connectors.importInvalidJson'))
      return
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      toast.error(t('connectors.importInvalidJson'))
      return
    }
    const record = parsed as Record<string, unknown>
    const servers = record.mcpServers
    if (servers === undefined || typeof servers !== 'object' || servers === null || Array.isArray(servers)) {
      toast.error(t('connectors.importMissingField'))
      return
    }
    const rows: ConnRow[] = []
    for (const [name, config] of Object.entries(servers as Record<string, unknown>)) {
      if (typeof config !== 'object' || config === null || Array.isArray(config)) continue
      rows.push(configToRow(name, config as Record<string, unknown>))
    }
    if (rows.length === 0) {
      toast.error(t('connectors.importEmpty'))
      return
    }
    onImport(rows)
    setText('')
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) { setText(''); onClose() } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('connectors.importTitle')}</DialogTitle>
        </DialogHeader>
        <p className="whitespace-pre-line text-xs text-muted-foreground">{t('connectors.importHint')}</p>
        <div className="space-y-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='{"mcpServers": { ... }}'
            spellCheck={false}
            className="min-h-48 font-mono text-xs"
          />
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={handleFile} />
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
            <FileUp data-icon="inline-start" />
            {t('connectors.importJson')}
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setText(''); onClose() }}>{t('connectors.importCancel')}</Button>
          <Button onClick={submit} disabled={text.trim().length === 0}>{t('connectors.importParse')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ConnectorsPage() {
  const { t } = useI18n()
  const [projectRows, setProjectRows] = useState<ConnRow[]>([])
  const [globalRows, setGlobalRows] = useState<ConnRow[]>([])
  const [connected, setConnected] = useState<McpConnected | null>(null)
  const [authMap, setAuthMap] = useState<Record<string, boolean>>({})
  const [flow, setFlow] = useState<{ name: string; flowId: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [configuredNames, setConfiguredNames] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<'visual' | 'json'>('visual')
  const [projectJson, setProjectJson] = useState('')
  const [globalJson, setGlobalJson] = useState('')
  const [importScope, setImportScope] = useState<'project' | 'global' | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    void Promise.all([
      fetchMcp()
        .then((payload) => {
          const pRows = payload.servers.filter((entry) => entry.scope === 'project').map((entry) => configToRow(entry.name, entry.config))
          const gRows = Object.entries(payload.map).map(([name, config]) => configToRow(name, config))
          setProjectRows(pRows)
          setGlobalRows(gRows)
          setProjectJson(rowsToJson(pRows))
          setGlobalJson(rowsToJson(gRows))
          setAuthMap(Object.fromEntries(payload.servers.map((entry) => [entry.name, entry.authenticated])))
          setConfiguredNames(new Set([...payload.servers.map((entry) => entry.name), ...Object.keys(payload.map)]))
        })
        .catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : String(cause))),
      fetchMcpConnected()
        .then(setConnected)
        .catch(() => setConnected(null)),
    ]).finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  function refresh(): void {
    setLoading(true)
    void reload().then(load).catch((cause: unknown) => {
      setLoading(false)
      toast.error(cause instanceof Error ? cause.message : String(cause))
    })
  }

  // MCP connections start asynchronously after the backend starts. Retry the
  // status once so a page opened immediately does not keep "none connected".
  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchMcpConnected().then(setConnected).catch(() => {})
    }, 2000)
    return () => clearTimeout(timer)
  }, [])

  // Poll an active MCP OAuth flow.
  useEffect(() => {
    if (!flow) return
    let cancelled = false
    const tick = async (): Promise<void> => {
      try {
        const status = await fetchOAuthStatus(flow.flowId)
        if (cancelled) return
        if (status.status === 'success') {
          toast.success(t('connectors.authenticated'))
          setFlow(null)
          load()
        } else if (status.status === 'error') {
          toast.error(status.error ?? t('oauth.signInFailed'))
          setFlow(null)
        }
      } catch (cause) {
        if (!cancelled) {
          toast.error(cause instanceof Error ? cause.message : String(cause))
          setFlow(null)
        }
      }
    }
    const timer = setInterval(() => void tick(), 2000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [flow, t, load])

  async function login(row: ConnRow): Promise<void> {
    const name = row.name.trim()
    const url = row.url.trim()
    if (name.length === 0 || url.length === 0) return
    try {
      const started = await startMcpOAuth(name, url)
      setFlow({ name, flowId: started.flowId })
      if (started.verificationUrl) window.open(started.verificationUrl, '_blank', 'noopener')
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  function update(scope: 'project' | 'global', index: number, patch: Partial<ConnRow>): void {
    const setter = scope === 'project' ? setProjectRows : setGlobalRows
    setter((current) => current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)))
  }

  function add(scope: 'project' | 'global'): void {
    const setter = scope === 'project' ? setProjectRows : setGlobalRows
    setter((current) => [...current, emptyRow()])
  }

  function remove(scope: 'project' | 'global', index: number): void {
    const setter = scope === 'project' ? setProjectRows : setGlobalRows
    setter((current) => current.filter((_, i) => i !== index))
  }

  /** Switch between visual and JSON modes, keeping state in sync. */
  function switchMode(next: 'visual' | 'json'): void {
    if (next === mode) return
    if (next === 'json') {
      // Serialize visual rows to JSON for editing
      setProjectJson(rowsToJson(projectRows))
      setGlobalJson(rowsToJson(globalRows))
      setMode('json')
      return
    }
    // Parse JSON back to rows
    try {
      setProjectRows(jsonToRows(projectJson))
    } catch {
      toast.error(t('settings.invalidJson'))
      return
    }
    try {
      setGlobalRows(jsonToRows(globalJson))
    } catch {
      toast.error(t('settings.invalidJson'))
      return
    }
    setMode('visual')
  }

  function handleImport(rows: ConnRow[]): void {
    if (importScope === null) return
    const setter = importScope === 'project' ? setProjectRows : setGlobalRows
    const existing = importScope === 'project' ? projectRows : globalRows
    const existingNames = new Set(existing.map((row) => row.name.trim()))
    let added = 0
    const newRows: ConnRow[] = []
    for (const row of rows) {
      const name = row.name.trim()
      if (existingNames.has(name)) {
        toast.info(t('connectors.importDuplicate', { name }))
        continue
      }
      existingNames.add(name)
      newRows.push(row)
      added++
    }
    if (added > 0) {
      setter((current) => [...current, ...newRows])
      toast.success(t('connectors.importAdded', { count: added }))
    }
    setImportScope(null)
  }

  async function save(scope: 'project' | 'global', rows: ConnRow[]): Promise<void> {
    const servers: Record<string, unknown> = {}
    // If in JSON mode, parse from JSON text first
    let effectiveRows = rows
    if (mode === 'json') {
      const jsonText = scope === 'project' ? projectJson : globalJson
      try {
        effectiveRows = jsonToRows(jsonText)
        if (scope === 'project') setProjectRows(effectiveRows)
        else setGlobalRows(effectiveRows)
      } catch {
        toast.error(t('settings.invalidJson'))
        return
      }
    }
    try {
      for (const row of effectiveRows) {
        const name = row.name.trim()
        if (name.length === 0) {
          toast.error(t('connectors.name'))
          return
        }
        servers[name] = rowToConfig(row)
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
      return
    }
    setBusy(scope)
    try {
      await saveMcp(servers, scope)
      toast.success(t('connectors.saved'))
      load()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  async function test(row: ConnRow): Promise<void> {
    try {
      const result = await testMcp(row.name.trim() || 'test', rowToConfig(row))
      toast.success(t('connectors.testOk', { count: result.tools.length }))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (row.transport !== 'stdio' && !authMap[row.name.trim()]) toast.error(t('connectors.loginFirst'))
      else toast.error(message)
    }
  }

  function renderRows(scope: 'project' | 'global', rows: ConnRow[]): React.ReactNode {
    return (
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">{t(scope === 'project' ? 'connectors.project' : 'connectors.global')}</CardTitle>
            <Badge variant="outline">{rows.length}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setImportScope(scope)}>
              <FileUp data-icon="inline-start" />
              {t('connectors.importJson')}
            </Button>
            <Button size="sm" onClick={() => void save(scope, rows)} disabled={busy === scope}>
              {t('settings.save')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {mode === 'json' ? (
            <Textarea
              aria-label={t('settings.json')}
              value={scope === 'project' ? projectJson : globalJson}
              onChange={(e) => (scope === 'project' ? setProjectJson : setGlobalJson)(e.target.value)}
              spellCheck={false}
              className="min-h-64 font-mono text-xs"
            />
          ) : (
            <>
              {loading && rows.length === 0 ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                  {t('connectors.loading')}
                </p>
              ) : rows.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('connectors.empty')}</p>
              ) : (
                rows.map((row, index) => {
                  const name = row.name.trim()
                  const server = connected?.servers.find((entry) => entry.name === name)
                  const connectionError = connected?.errors.find((entry) => entry.name === name)
                  const saved = configuredNames.has(name)
                  return (
                    <div key={index} className="space-y-2 rounded-lg border p-3">
                      <div className="flex items-center gap-2">
                        <Input value={row.name} onChange={(e) => update(scope, index, { name: e.target.value })} placeholder={t('connectors.name')} className="font-medium" />
                        <Select
                          value={row.transport}
                          onValueChange={(value: string) => update(scope, index, { transport: value as Transport })}
                        >
                          <SelectTrigger aria-label={t('connectors.transport')} className="h-9 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TRANSPORTS.map((value) => (
                              <SelectItem key={value} value={value}>
                                {value}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {server ? (
                          <Badge variant="default">{t('connectors.toolCount', { count: server.tools.length })}</Badge>
                        ) : connectionError ? (
                          <Badge variant="destructive" title={connectionError.message}>{t('connectors.error')}</Badge>
                        ) : saved && !loading ? (
                          <Badge variant="outline">{t('connectors.notConnected')}</Badge>
                        ) : null}
                        {row.transport !== 'stdio' && authMap[row.name] ? (
                          <Badge variant="default">{t('connectors.authenticated')}</Badge>
                        ) : null}
                        {row.transport !== 'stdio' ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            title={t('connectors.login')}
                            onClick={() => void login(row)}
                            disabled={flow?.name === row.name.trim() || row.url.trim().length === 0}
                          >
                            <KeyRound />
                          </Button>
                        ) : null}
                        <Button size="icon" variant="ghost" title={t('connectors.test')} onClick={() => void test(row)}>
                          <FlaskConical />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => remove(scope, index)}>
                          <Trash2 />
                        </Button>
                      </div>
                      {row.transport === 'stdio' ? (
                        <div className="space-y-2">
                          <Input value={row.command} onChange={(e) => update(scope, index, { command: e.target.value })} placeholder={t('connectors.command')} className="font-mono text-xs" />
                          <Input value={row.args} onChange={(e) => update(scope, index, { args: e.target.value })} placeholder={t('connectors.args')} className="font-mono text-xs" />
                          <Textarea value={row.env} onChange={(e) => update(scope, index, { env: e.target.value })} spellCheck={false} className="min-h-16 font-mono text-xs" placeholder={t('connectors.env')} />
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <Input value={row.url} onChange={(e) => update(scope, index, { url: e.target.value })} placeholder={t('connectors.url')} className="font-mono text-xs" />
                          <Textarea value={row.headers} onChange={(e) => update(scope, index, { headers: e.target.value })} spellCheck={false} className="min-h-16 font-mono text-xs" placeholder={t('connectors.headers')} />
                        </div>
                      )}
                    </div>
                  )
                })
              )}
              <Button variant="outline" size="sm" onClick={() => add(scope)}>
                <Plus data-icon="inline-start" />
                {t('connectors.add')}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{t('settings.connectors')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('connectors.hint')}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border p-0.5">
            <Button size="sm" variant={mode === 'visual' ? 'secondary' : 'ghost'} onClick={() => switchMode('visual')}>
              {t('settings.visual')}
            </Button>
            <Button size="sm" variant={mode === 'json' ? 'secondary' : 'ghost'} onClick={() => switchMode('json')}>
              {t('settings.json')}
            </Button>
          </div>
          <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
            <RefreshCw className={loading ? 'animate-spin' : undefined} data-icon="inline-start" />
            {t('workspace.refresh')}
          </Button>
        </div>
      </div>

      {loading && !connected ? (
        <div className="flex items-center gap-2 rounded-lg border p-3 text-xs text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          {t('connectors.loading')}
        </div>
      ) : connected ? (
        <div className="rounded-lg border p-3">
          <p className="mb-2 text-xs font-medium">{t('connectors.connected')}</p>
          {connected.servers.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('connectors.noneConnected')}</p>
          ) : (
            <ul className="space-y-1">
              {connected.servers.map((server) => (
                <li key={server.name} className="flex items-center gap-2 text-xs">
                  <Badge variant="default">{server.name}</Badge>
                  <span className="text-muted-foreground">{t('connectors.toolCount', { count: server.tools.length })}</span>
                </li>
              ))}
            </ul>
          )}
          {connected.errors.map((error) => (
            <p key={error.name} className="mt-1 text-xs text-destructive">
              {error.name}: {error.message}
            </p>
          ))}
        </div>
      ) : null}

      {renderRows('project', projectRows)}
      {renderRows('global', globalRows)}

      <ImportDialog open={importScope !== null} onClose={() => setImportScope(null)} onImport={handleImport} />
    </div>
  )
}
