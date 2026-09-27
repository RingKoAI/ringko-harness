import { Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { fetchMcp, saveMcp } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'

interface Row {
  name: string;
  config: string;
}

export function ConnectorsPage() {
  const { t } = useI18n()
  const [rows, setRows] = useState<Row[]>([])
  const [kinds, setKinds] = useState<Record<string, string>>({})
  const [sources, setSources] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    fetchMcp()
      .then((payload) => {
        setRows(Object.entries(payload.map).map(([name, config]) => ({ name, config: JSON.stringify(config, null, 2) })))
        setKinds(Object.fromEntries(payload.servers.map((entry) => [entry.name, entry.kind])))
        setSources(Object.fromEntries(payload.servers.map((entry) => [entry.name, entry.source])))
      })
      .catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : String(cause)))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function save(): Promise<void> {
    const servers: Record<string, unknown> = {}
    for (const row of rows) {
      const name = row.name.trim()
      if (name.length === 0) {
        toast.error(t('connectors.name'));
        return;
      }
      try {
        servers[name] = JSON.parse(row.config)
      } catch {
        toast.error(t('connectors.invalidJson'))
        return
      }
    }
    setBusy(true)
    try {
      await saveMcp(servers)
      toast.success(t('connectors.saved'))
      load()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>{t('settings.connectors')}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{t('connectors.hint')}</p>
        </div>
        <Button size="sm" onClick={() => void save()} disabled={busy}>
          {t('settings.save')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('connectors.empty')}</p>
        ) : (
          rows.map((row, index) => (
            <div key={index} className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Input
                  value={row.name}
                  onChange={(event) =>
                    setRows((current) => current.map((entry, i) => (i === index ? { ...entry, name: event.target.value } : entry)))
                  }
                  placeholder={t('connectors.name')}
                  className="font-medium"
                />
                {kinds[row.name] ? <Badge variant="secondary">{kinds[row.name]}</Badge> : null}
                {sources[row.name] ? <Badge variant="outline">{sources[row.name]}</Badge> : null}
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                >
                  <Trash2 />
                </Button>
              </div>
              <Textarea
                value={row.config}
                onChange={(event) =>
                  setRows((current) => current.map((entry, i) => (i === index ? { ...entry, config: event.target.value } : entry)))
                }
                spellCheck={false}
                className="min-h-28 font-mono text-xs"
                placeholder={t('connectors.config')}
              />
            </div>
          ))
        )}
        <Button variant="outline" onClick={() => setRows((current) => [...current, { name: '', config: '{\n  "command": ""\n}' }])}>
          <Plus data-icon="inline-start" />
          {t('connectors.add')}
        </Button>
      </CardContent>
    </Card>
  )
}
