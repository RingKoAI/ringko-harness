import { Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { discoverProviderModels, fetchPresets, fetchProviders, saveProviders, type ProviderDefinition, type ProviderFile, type ProviderPreset } from '@/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { isOAuthProviderType } from '@/lib/oauth'
import { mergeDiscoveredModels, newModelCount } from '@/lib/provider-models'
import { parseProviderFile } from '@/lib/provider-file'
import { useApp } from '@/store'

const TYPES = ['openai-compatible', 'openai', 'anthropic', 'google']

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
  const [presets, setPresets] = useState<ProviderPreset[]>([])
  const [presetId, setPresetId] = useState('')
  const [discovering, setDiscovering] = useState<number | null>(null)
  const [savedText, setSavedText] = useState('')

  const serialize = (value: ProviderFile): string => JSON.stringify({ model: value.model ?? '', small_model: value.small_model ?? '', providers: value.providers ?? [] }, null, 2)
  const currentText = mode === 'json' ? json : serialize(file)
  const dirty = savedText.length > 0 && currentText !== savedText

  const load = useCallback(() => {
    fetchProviders()
      .then((value) => {
        const text = serialize(value)
        setFile(value)
        setJson(text)
        setSavedText(text)
      })
      .catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : String(cause)))
  }, [])

  /** Switch editors without losing either side: serialize visual state, validate JSON. */
  function switchMode(next: 'visual' | 'json'): void {
    if (next === mode) return
    if (next === 'json') {
      setJson(serialize(file))
      setMode('json')
      return
    }
    let parsed: ProviderFile
    try {
      parsed = parseProviderFile(json)
    } catch {
      toast.error(t('settings.invalidJson'))
      return
    }
    setFile(parsed)
    setMode('visual')
  }

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    fetchPresets()
      .then((value) => setPresets(value.presets))
      .catch(() => {})
  }, [])

  function addPreset(): void {
    const preset = presets.find((entry) => entry.id === presetId)
    if (!preset) return
    const provider: ProviderDefinition = { name: preset.id, type: preset.type, models: [] }
    if (preset.baseURL) provider.baseURL = preset.baseURL
    setFile((current) => ({ ...current, providers: [...(current.providers ?? []), provider] }))
    setPresetId('')
  }

  const providers = (file.providers ?? [])
    .map((provider, index) => ({ provider, index }))
    .filter(({ provider }) => !isOAuthProviderType(provider.type ?? provider.vendor))

  function patchProvider(index: number, patch: Partial<ProviderDefinition>): void {
    setFile((current) => ({
      ...current,
      providers: (current.providers ?? []).map((provider, i) => (i === index ? { ...provider, ...patch } : provider)),
    }))
  }

  async function discover(index: number): Promise<void> {
    const provider = (file.providers ?? [])[index]
    if (!provider) return
    setDiscovering(index)
    try {
      const result = await discoverProviderModels({
        name: provider.name,
        type: provider.type ?? 'openai-compatible',
        ...(provider.baseURL ? { baseURL: provider.baseURL } : {}),
        ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
      })
      const existing = provider.models ?? []
      const added = newModelCount(existing, result.models)
      patchProvider(index, { models: mergeDiscoveredModels(existing, result.models) })
      toast.success(added > 0 ? t('settings.modelsFetched', { count: added }) : t('settings.noNewModels'))
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setDiscovering(null)
    }
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
          {dirty ? <span className="text-xs text-amber-600 dark:text-amber-400">{t('settings.unsaved')}</span> : null}
          <div className="flex rounded-md border p-0.5">
            <Button size="sm" variant={mode === 'visual' ? 'secondary' : 'ghost'} onClick={() => switchMode('visual')}>
              {t('settings.visual')}
            </Button>
            <Button size="sm" variant={mode === 'json' ? 'secondary' : 'ghost'} onClick={() => switchMode('json')}>
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
            <p className="text-xs text-muted-foreground">{t('settings.oauthHint')}</p>
            <div className="flex items-center gap-2">
              <select
                value={presetId}
                onChange={(event) => setPresetId(event.target.value)}
                className="h-9 flex-1 rounded-md border bg-transparent px-2 text-sm"
              >
                <option value="">{t('settings.fromPreset')}</option>
                {presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                    {preset.apiKeyEnv ? ` · ${preset.apiKeyEnv}` : ''}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="outline" onClick={addPreset} disabled={presetId === ''}>
                {t('settings.addProvider')}
              </Button>
            </div>
            {providers.map(({ provider, index }) => (
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
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    disabled={discovering === index}
                    title={t('settings.fetchModels')}
                    onClick={() => void discover(index)}
                  >
                    <RefreshCw data-icon="inline-start" className={discovering === index ? 'animate-spin' : undefined} />
                    {discovering === index ? t('settings.fetchingModels') : t('settings.fetchModels')}
                  </Button>
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
