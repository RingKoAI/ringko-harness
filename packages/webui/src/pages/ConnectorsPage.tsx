import { FlaskConical, KeyRound, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { fetchMcp, fetchMcpConnected, fetchOAuthStatus, saveMcp, startMcpOAuth, testMcp, type McpConnected } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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

export function ConnectorsPage() {
  const { t } = useI18n()
  const [projectRows, setProjectRows] = useState<ConnRow[]>([])
  const [globalRows, setGlobalRows] = useState<ConnRow[]>([])
  const [connected, setConnected] = useState<McpConnected | null>(null)
  const [authMap, setAuthMap] = useState<Record<string, boolean>>({})
  const [flow, setFlow] = useState<{ name: string; flowId: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchMcp()
      .then((payload) => {
        setProjectRows(payload.servers.filter((entry) => entry.scope === 'project').map((entry) => configToRow(entry.name, entry.config)))
        setGlobalRows(Object.entries(payload.map).map(([name, config]) => configToRow(name, config)))
        setAuthMap(Object.fromEntries(payload.servers.map((entry) => [entry.name, entry.authenticated])))
      })
      .catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : String(cause)))
    fetchMcpConnected()
      .then(setConnected)
      .catch(() => setConnected(null))
  }, [])

  useEffect(load, [load])

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

  async function save(scope: 'project' | 'global', rows: ConnRow[]): Promise<void> {
    const servers: Record<string, unknown> = {}
    try {
      for (const row of rows) {
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
          <Button size="sm" onClick={() => void save(scope, rows)} disabled={busy === scope}>
            {t('settings.save')}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('connectors.empty')}</p>
          ) : (
            rows.map((row, index) => (
              <div key={index} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Input value={row.name} onChange={(e) => update(scope, index, { name: e.target.value })} placeholder={t('connectors.name')} className="font-medium" />
                  <select
                    value={row.transport}
                    onChange={(e) => update(scope, index, { transport: e.target.value as Transport })}
                    className="h-9 rounded-md border bg-transparent px-2 text-sm"
                  >
                    {TRANSPORTS.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
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
            ))
          )}
          <Button variant="outline" size="sm" onClick={() => add(scope)}>
            <Plus data-icon="inline-start" />
            {t('connectors.add')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">{t('settings.connectors')}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('connectors.hint')}</p>
      </div>

      {connected ? (
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
    </div>
  )
}
