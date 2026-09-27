import { Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { fetchProviders, saveProviders, type ProviderDefinition, type ProviderFile } from '@/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { useApp } from '@/store'

const TYPES = ['openai-compatible', 'openai', 'openai-oauth', 'anthropic', 'google', 'github-copilot']

function emptyProvider(): ProviderDefinition {
  return { name: 'new-provider', type: 'openai-compatible', baseURL: '', apiKey: '', models: [] }
}

export function ProvidersPage() {
  const { t } = useI18n()
  const app = useApp()
  const [file, setFile] = useState<ProviderFile>({ providers: [] })
  const [mode, setMode] = useState<'visual' | 'json'>('visual')
  const [json, setJson] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    fetchProviders()
      .then((value) => {
        setFile(value)
        setJson(JSON.stringify({ model: value.model ?? '', small_model: value.small_model ?? '', providers: value.providers ?? [] }, null, 2))
      })
      .catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : String(cause)))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const providers = file.providers ?? []

  function patchProvider(index: number, patch: Partial<ProviderDefinition>): void {
    setFile((current) => ({
      ...current,
      providers: (current.providers ?? []).map((provider, i) => (i === index ? { ...provider, ...patch } : provider)),
    }))
  }

  async function save(): Promise<void> {
    setBusy(true)
    try {
      let payload: ProviderFile
      if (mode === 'json') {
        try {
          payload = JSON.parse(json) as ProviderFile
        } catch {
          toast.error(t('settings.invalidJson'))
          return
        }
      } else {
        payload = file
      }
      await saveProviders(payload)
      app.refreshInfo()
      toast.success(t('settings.saved'))
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
          <CardTitle>{t('settings.providers')}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{t('settings.providersHint')}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border p-0.5">
            <Button size="sm" variant={mode === 'visual' ? 'secondary' : 'ghost'} onClick={() => setMode('visual')}>
              {t('settings.visual')}
            </Button>
            <Button size="sm" variant={mode === 'json' ? 'secondary' : 'ghost'} onClick={() => setMode('json')}>
              {t('settings.json')}
            </Button>
          </div>
          <Button size="sm" onClick={() => void save()} disabled={busy}>
            {t('settings.save')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {mode === 'json' ? (
          <Textarea
            value={json}
            onChange={(event) => setJson(event.target.value)}
            spellCheck={false}
            className="min-h-96 font-mono text-xs"
          />
        ) : (
          <>
            {providers.map((provider, index) => (
              <div key={index} className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Input
                    value={provider.name}
                    onChange={(event) => patchProvider(index, { name: event.target.value })}
                    placeholder={t('settings.providerName')}
                    className="font-medium"
                  />
                  <Input
                    value={provider.type ?? ''}
                    onChange={(event) => patchProvider(index, { type: event.target.value })}
                    placeholder={t('settings.providerType')}
                    list="ringko-provider-types"
                    className="w-48"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setFile((current) => ({ ...current, providers: (current.providers ?? []).filter((_, i) => i !== index) }))}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    value={provider.baseURL ?? ''}
                    onChange={(event) => patchProvider(index, { baseURL: event.target.value })}
                    placeholder={t('settings.baseUrl')}
                    className="font-mono text-xs"
                  />
                  <Input
                    type="password"
                    value={provider.apiKey ?? ''}
                    onChange={(event) => patchProvider(index, { apiKey: event.target.value })}
                    placeholder={t('settings.apiKey')}
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-2">
                  {(provider.models ?? []).map((model, modelIndex) => (
                    <div key={modelIndex} className="flex items-center gap-2">
                      <Input
                        value={model.id}
                        onChange={(event) =>
                          patchProvider(index, {
                            models: (provider.models ?? []).map((entry, i) => (i === modelIndex ? { ...entry, id: event.target.value } : entry)),
                          })
                        }
                        placeholder={t('settings.modelId')}
                        className="font-mono text-xs"
                      />
                      <Input
                        value={model.name}
                        onChange={(event) =>
                          patchProvider(index, {
                            models: (provider.models ?? []).map((entry, i) => (i === modelIndex ? { ...entry, name: event.target.value } : entry)),
                          })
                        }
                        placeholder={t('settings.modelName')}
                        className="text-xs"
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() =>
                          patchProvider(index, { models: (provider.models ?? []).filter((_, i) => i !== modelIndex) })
                        }
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => patchProvider(index, { models: [...(provider.models ?? []), { id: '', name: '' }] })}
                  >
                    <Plus data-icon="inline-start" />
                    {t('settings.addModel')}
                  </Button>
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() => setFile((current) => ({ ...current, providers: [...(current.providers ?? []), emptyProvider()] }))}
            >
              <Plus data-icon="inline-start" />
              {t('settings.addProvider')}
            </Button>
          </>
        )}
      </CardContent>
      <datalist id="ringko-provider-types">
        {TYPES.map((type) => (
          <option key={type} value={type} />
        ))}
      </datalist>
    </Card>
  )
}
