import { LoaderCircle, Plus, Search, Wand2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  fetchPresets,
  fetchProviders,
  saveProviders,
  type ProviderCredentialStatus,
  type ProviderFile,
  type ProviderPreset,
} from '@/api'
import { BuiltinPresetCard } from '@/components/providers/builtin-preset-card'
import { ProviderCard } from '@/components/providers/provider-card'
import { ProviderEditorPanel } from '@/components/providers/provider-editor-panel'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import {
  ModelSettingsError,
  normalizeProviderFile,
  TOKEN_LABELS,
  type EditableProvider,
  type EditableProviderFile,
} from '@/lib/model-settings'
import { parseProviderFile } from '@/lib/provider-file'
import {
  activeProviderName,
  buildQuickActivatedProvider,
  cloneProvider,
  dedupeProviderName,
  filterProviderIndices,
  probeProviderModels,
  reorderProviders,
  unconfiguredBuiltinPresets,
} from '@/lib/provider-workbench'
import { useApp } from '@/store'

type EditorTarget =
  | { kind: 'list' }
  | { kind: 'add'; initial?: EditableProvider }
  | { kind: 'edit'; index: number }

/**
 * Radix Select cannot carry an empty item value, so "no model selected"
 * travels as this sentinel and is mapped back to an empty id at the edge.
 */
const NONE_MODEL = '__none__'

function rewriteModelOwner(
  currentModel: string | undefined,
  oldProviderName: string,
  newProviderName: string,
): string | undefined {
  if (!currentModel || oldProviderName === newProviderName) return currentModel
  const prefix = `${oldProviderName}/`
  return currentModel.startsWith(prefix)
    ? `${newProviderName}/${currentModel.slice(prefix.length)}`
    : currentModel
}

export function ProvidersPage() {
  const { t } = useI18n()
  const app = useApp()

  const [file, setFile] = useState<EditableProviderFile>({ providers: [] })
  const [credentials, setCredentials] = useState<Record<string, ProviderCredentialStatus>>({})
  const [mode, setMode] = useState<'visual' | 'json'>('visual')
  const [editorTarget, setEditorTarget] = useState<EditorTarget>({ kind: 'list' })
  const [searchQuery, setSearchQuery] = useState('')
  const [json, setJson] = useState('')
  const [savedText, setSavedText] = useState('')

  const [presets, setPresets] = useState<ProviderPreset[]>([])
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)

  const [testingIndex, setTestingIndex] = useState<number | null>(null)
  const [latencies, setLatencies] = useState<Record<string, number | 'error'>>({})
  const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<{ index: number; after: boolean } | null>(null)

  const loadSequence = useRef(0)
  const savingRef = useRef(false)

  const serialize = useCallback(
    (value: EditableProviderFile): string =>
      JSON.stringify(
        {
          model: value.model ?? '',
          small_model: value.small_model ?? '',
          providers: value.providers ?? [],
        },
        null,
        2,
      ),
    [],
  )

  const jsonDirty = mode === 'json' && savedText.length > 0 && json !== savedText

  const applyFetchedFile = useCallback(
    (value: ProviderFile) => {
      const clean: EditableProviderFile = {
        ...(value.model !== undefined ? { model: value.model } : {}),
        ...(value.small_model !== undefined ? { small_model: value.small_model } : {}),
        providers: value.providers ?? [],
      }
      const text = serialize(clean)
      setFile(clean)
      setJson(text)
      setSavedText(text)
      if (value.credentials) setCredentials(value.credentials)
      if (value.builtinPresets && value.builtinPresets.length > 0) {
        setPresets(value.builtinPresets)
      }
    },
    [serialize],
  )

  const load = useCallback(() => {
    const sequence = ++loadSequence.current
    fetchProviders()
      .then(value => {
        if (loadSequence.current !== sequence) return
        applyFetchedFile(value)
        setLoaded(true)
        setLoadError(false)
      })
      .catch((cause: unknown) => {
        if (loadSequence.current === sequence) {
          setLoadError(true)
          toast.error(cause instanceof Error ? cause.message : String(cause))
        }
      })
  }, [applyFetchedFile])

  useEffect(() => {
    load()
    return () => {
      loadSequence.current += 1
    }
  }, [load])

  useEffect(() => {
    fetchPresets()
      .then(value => {
        if (value.presets.length > 0) setPresets(value.presets)
      })
      .catch(() => {})
  }, [])

  function reportError(cause: unknown): void {
    if (cause instanceof ModelSettingsError) {
      const field =
        cause.field === 'id'
          ? t('settings.modelId')
          : cause.field === 'catalogId'
            ? t('models.catalogId')
            : cause.field === 'reasoningEfforts'
              ? t('models.reasoningTitle')
              : t(TOKEN_LABELS[cause.field])
      toast.error(t(`models.error.${cause.reason}`, { model: cause.modelId || '—', field }))
    } else {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function persistFile(nextEditable: EditableProviderFile, successToast?: string): Promise<boolean> {
    if (savingRef.current || !loaded) return false
    savingRef.current = true
    setBusy(true)
    try {
      const normalized = normalizeProviderFile(nextEditable)
      await saveProviders(normalized)
      // Refresh authoritative redacted state & credential status from backend
      const refreshed = await fetchProviders()
      applyFetchedFile(refreshed)
      app.refreshInfo()
      if (successToast) toast.success(successToast)
      return true
    } catch (cause) {
      reportError(cause)
      return false
    } finally {
      savingRef.current = false
      setBusy(false)
    }
  }

  async function saveJsonMode(): Promise<void> {
    if (savingRef.current || !loaded) return
    let parsed: ProviderFile
    try {
      parsed = parseProviderFile(json)
    } catch (cause) {
      if (cause instanceof ModelSettingsError) reportError(cause)
      else toast.error(t('settings.invalidJson'))
      return
    }
    await persistFile(parsed, t('settings.saved'))
  }

  function switchMode(next: 'visual' | 'json'): void {
    if (next === mode) return
    if (next === 'json') {
      try {
        const normalized = normalizeProviderFile(file)
        setJson(serialize(normalized))
        setFile(normalized)
        setMode('json')
      } catch (cause) {
        reportError(cause)
      }
      return
    }
    try {
      const parsed = parseProviderFile(json)
      setFile(parsed)
      setMode('visual')
    } catch (cause) {
      if (cause instanceof ModelSettingsError) reportError(cause)
      else toast.error(t('settings.invalidJson'))
    }
  }

  const providers = useMemo(() => file.providers ?? [], [file.providers])
  const builtinIdSet = useMemo(() => new Set(presets.map(p => p.id.toLowerCase())), [presets])
  const activeFullModel = file.model?.trim() || app.info?.modelId || null
  const currentActiveProvider = activeProviderName(activeFullModel)

  const allModelOptions = useMemo(() => {
    const out: Array<{ fullId: string; label: string }> = []
    for (const provider of providers) {
      if (provider.enabled === false) continue
      for (const model of provider.models ?? []) {
        const id = model.id.trim()
        if (!id) continue
        const fullId = `${provider.name}/${id}`
        out.push({
          fullId,
          label: model.name && model.name !== id ? `${fullId} (${model.name})` : fullId,
        })
      }
    }
    return out
  }, [providers])

  const filteredIndices = useMemo(
    () => filterProviderIndices(providers, searchQuery),
    [providers, searchQuery],
  )

  const availableBuiltins = useMemo(
    () => unconfiguredBuiltinPresets(presets, providers, credentials, searchQuery),
    [presets, providers, credentials, searchQuery],
  )

  async function handleSelectModel(fullModelId: string): Promise<void> {
    const providerName = fullModelId.slice(0, fullModelId.indexOf('/'))
    await persistFile(
      {
        ...file,
        model: fullModelId,
        // Selecting a model is what makes a provider in use; a provider left
        // disabled by an older configuration joins the list again here.
        providers: providers.map(entry =>
          entry.name === providerName && entry.enabled === false ? { ...entry, enabled: true } : entry,
        ),
      },
      t('providers.switched', { model: fullModelId }),
    )
  }

  async function handleSelectSmallModel(fullModelId: string): Promise<void> {
    const next: EditableProviderFile = { ...file }
    if (fullModelId) next.small_model = fullModelId
    else delete next.small_model
    await persistFile(next, t('settings.saved'))
  }

  async function handleQuickActivatePreset(
    preset: ProviderPreset,
    rawApiKey?: string,
  ): Promise<boolean> {
    const activated = buildQuickActivatedProvider(preset, rawApiKey)
    const nextProviders = [...providers, activated]
    const shouldAutoSelectModel = !file.model?.trim() && activated.models?.[0]?.id.trim()
    return await persistFile(
      {
        ...file,
        ...(shouldAutoSelectModel
          ? { model: `${activated.name}/${activated.models![0]!.id.trim()}` }
          : {}),
        providers: nextProviders,
      },
      t('settings.saved'),
    )
  }

  function handleOpenPresetInFullEditor(preset: ProviderPreset, rawApiKey?: string): void {
    const initial = buildQuickActivatedProvider(preset, rawApiKey)
    setEditorTarget({ kind: 'add', initial })
  }

  async function handleDuplicate(index: number): Promise<void> {
    const source = providers[index]
    if (!source) return
    const copy = cloneProvider(
      source,
      providers.map(p => p.name),
    )
    const nextProviders = [...providers]
    nextProviders.splice(index + 1, 0, copy)
    await persistFile(
      { ...file, providers: nextProviders },
      t('providers.duplicated', { name: copy.name }),
    )
  }

  async function handleMove(index: number, delta: -1 | 1): Promise<void> {
    const target = index + delta
    if (target < 0 || target >= providers.length) return
    const nextProviders = [...providers]
    const [moved] = nextProviders.splice(index, 1)
    if (!moved) return
    nextProviders.splice(target, 0, moved)
    await persistFile({ ...file, providers: nextProviders })
  }

  /** Land a dragged provider immediately before or after the card it was dropped on. */
  async function handleDropAt(from: number, to: number, after: boolean): Promise<void> {
    const nextProviders = reorderProviders(providers, from, to, after)
    if (!nextProviders) return
    await persistFile({ ...file, providers: nextProviders })
  }

  async function handleTestCard(index: number): Promise<void> {
    const provider = providers[index]
    if (!provider || testingIndex !== null) return
    setTestingIndex(index)
    try {
      const res = await probeProviderModels(provider)
      setLatencies(prev => ({ ...prev, [provider.name]: res.latencyMs }))
      toast.success(t('providers.testOk', { ms: res.latencyMs, count: res.models.length }))
    } catch (cause) {
      setLatencies(prev => ({ ...prev, [provider.name]: 'error' }))
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setTestingIndex(null)
    }
  }

  function requestDelete(index: number): void {
    const provider = providers[index]
    if (!provider) return
    if (currentActiveProvider === provider.name) {
      toast.warning(t('providers.deleteActiveGuard'))
      return
    }
    setPendingDeleteIndex(index)
  }

  async function confirmDelete(): Promise<void> {
    if (pendingDeleteIndex === null) return
    const index = pendingDeleteIndex
    const removed = providers[index]
    setPendingDeleteIndex(null)
    const nextProviders = providers.filter((_, idx) => idx !== index)
    await persistFile(
      {
        ...file,
        providers: nextProviders,
        ...(removed ? { removedProviders: [removed.name] } : {}),
      },
      t('settings.saved'),
    )
  }

  if (mode === 'visual' && editorTarget.kind !== 'list') {
    const isAdd = editorTarget.kind === 'add'
    const editingProvider = !isAdd ? providers[editorTarget.index] : undefined
    const initialProvider: EditableProvider = isAdd
      ? editorTarget.initial ?? {
        name: dedupeProviderName('custom-provider', providers.map(p => p.name)),
        type: 'openai-compatible',
        baseURL: '',
        apiKey: '',
        models: [],
      }
      : editingProvider ?? {
        name: 'provider',
        type: 'openai-compatible',
        models: [],
      }

    const existingNames = providers
      .filter((_, idx) => isAdd || idx !== editorTarget.index)
      .map(p => p.name)

    return (
      <ProviderEditorPanel
        mode={isAdd ? 'add' : 'edit'}
        initialProvider={initialProvider}
        credentialStatus={credentials[initialProvider.name]}
        existingNames={existingNames}
        presets={presets}
        saving={busy}
        onCancel={() => setEditorTarget({ kind: 'list' })}
        onSave={async savedProvider => {
          const nextProviders = [...providers]
          let nextModel = file.model
          let nextSmallModel = file.small_model

          if (isAdd) {
            nextProviders.push(savedProvider)
            if (!nextModel?.trim() && savedProvider.models?.[0]?.id.trim()) {
              nextModel = `${savedProvider.name}/${savedProvider.models[0].id.trim()}`
            }
          } else {
            const oldName = editingProvider?.name ?? savedProvider.name
            nextProviders[editorTarget.index] = savedProvider
            nextModel = rewriteModelOwner(nextModel, oldName, savedProvider.name)
            nextSmallModel = rewriteModelOwner(nextSmallModel, oldName, savedProvider.name)
          }

          const ok = await persistFile(
            {
              ...file,
              ...(nextModel !== undefined ? { model: nextModel } : {}),
              ...(nextSmallModel !== undefined ? { small_model: nextSmallModel } : {}),
              providers: nextProviders,
            },
            t('settings.saved'),
          )
          if (ok) setEditorTarget({ kind: 'list' })
        }}
      />
    )
  }

  const pendingDeleteProvider = pendingDeleteIndex !== null ? providers[pendingDeleteIndex] : undefined

  return (
    <div className="space-y-4">
      {loadError ? (
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <span>{t('models.loadFailed')}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setLoaded(false)
              load()
            }}
          >
            {t('settings.reload')}
          </Button>
        </p>
      ) : null}

      <Card>
        <CardHeader className="flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <CardTitle>{t('settings.providers')}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('settings.providersHint')} {t('settings.oauthHint')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {jsonDirty ? (
              <span className="text-xs text-amber-600 dark:text-amber-400">
                {t('settings.unsaved')}
              </span>
            ) : null}

            <div className="flex rounded-md border p-0.5">
              <Button
                size="sm"
                variant={mode === 'visual' ? 'secondary' : 'ghost'}
                disabled={!loaded || busy}
                onClick={() => switchMode('visual')}
              >
                {t('settings.visual')}
              </Button>
              <Button
                size="sm"
                variant={mode === 'json' ? 'secondary' : 'ghost'}
                disabled={!loaded || busy}
                onClick={() => switchMode('json')}
              >
                {t('settings.json')}
              </Button>
            </div>

            {mode === 'visual' ? (
              <Button
                size="sm"
                disabled={!loaded || busy}
                onClick={() => setEditorTarget({ kind: 'add' })}
              >
                <Plus data-icon="inline-start" className="size-4" />
                {t('providers.addCustomEndpoint')}
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!loaded || busy}
                  onClick={() => {
                    try {
                      setJson(JSON.stringify(JSON.parse(json), null, 2))
                    } catch {
                      toast.error(t('settings.invalidJson'))
                    }
                  }}
                >
                  <Wand2 data-icon="inline-start" className="size-3.5" />
                  {t('providers.formatJson')}
                </Button>
                <Button size="sm" disabled={!loaded || busy} onClick={() => void saveJsonMode()}>
                  {busy ? <LoaderCircle data-icon="inline-start" className="size-3.5 animate-spin" /> : null}
                  {t('settings.save')}
                </Button>
              </>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {!loaded && !loadError ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('models.loadingSettings')}
            </p>
          ) : null}

          {mode === 'json' ? (
            <Textarea
              aria-label={t('settings.json')}
              value={json}
              onChange={event => setJson(event.target.value)}
              spellCheck={false}
              className="min-h-96 font-mono text-xs"
            />
          ) : loaded ? (
            <>
              {/* Active primary & helper model selector bar */}
              {allModelOptions.length > 0 ? (
                <div className="grid gap-2 rounded-xl border bg-muted/25 p-3 sm:grid-cols-2">
                  <div className="space-y-1 text-xs">
                    <span className="font-medium text-muted-foreground">
                      {t('providers.activeModel')}
                    </span>
                    <Select
                      value={activeFullModel ?? NONE_MODEL}
                      disabled={busy}
                      onValueChange={value => {
                        if (value !== NONE_MODEL) void handleSelectModel(value)
                      }}
                    >
                      <SelectTrigger
                        aria-label={t('providers.activeModel')}
                        className="h-8 w-full font-mono text-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {!activeFullModel ? (
                          <SelectItem value={NONE_MODEL}>{t('providers.noneSelected')}</SelectItem>
                        ) : null}
                        {allModelOptions.map(opt => (
                          <SelectItem key={opt.fullId} value={opt.fullId}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1 text-xs">
                    <span className="font-medium text-muted-foreground">
                      {t('providers.smallModel')}
                    </span>
                    <Select
                      value={file.small_model ?? NONE_MODEL}
                      disabled={busy}
                      onValueChange={value => void handleSelectSmallModel(value === NONE_MODEL ? '' : value)}
                    >
                      <SelectTrigger
                        aria-label={t('providers.smallModel')}
                        className="h-8 w-full font-mono text-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE_MODEL}>{t('providers.noneSelected')}</SelectItem>
                        {allModelOptions.map(opt => (
                          <SelectItem key={opt.fullId} value={opt.fullId}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}

              {/* Unified Search Bar */}
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={event => setSearchQuery(event.target.value)}
                  placeholder={t('providers.search')}
                  className="h-8 pl-8 text-xs"
                />
              </div>

              {/* Section 1: Configured Providers */}
              {providers.length > 0 ? (
                <div className="space-y-2.5">
                  <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {t('providers.configuredSection', { count: filteredIndices.length })}
                  </h3>
                  {filteredIndices.length === 0 ? (
                    <p className="py-4 text-center text-xs text-muted-foreground">
                      {t('providers.noSearchMatch', { query: searchQuery })}
                    </p>
                  ) : (
                    filteredIndices.map(index => {
                      const provider = providers[index]!
                      const isBuiltin = Boolean(
                        (provider.presetId && builtinIdSet.has(provider.presetId.toLowerCase())) ||
                          builtinIdSet.has(provider.name.toLowerCase()),
                      )
                      return (
                        <ProviderCard
                          key={`${index}-${provider.name}`}
                          provider={provider}
                          credentialStatus={credentials[provider.name]}
                          isBuiltin={isBuiltin}
                          isActiveProvider={currentActiveProvider === provider.name}
                          canMoveUp={index > 0}
                          canMoveDown={index < providers.length - 1}
                          testing={testingIndex === index}
                          latencyMs={latencies[provider.name]}
                          disabled={busy}
                          dragging={dragIndex === index}
                          dropIndicator={
                            dragIndex !== null && dragIndex !== index && dropTarget?.index === index
                              ? (dropTarget.after ? 'after' : 'before')
                              : undefined
                          }
                          onDragStart={() => {
                            setDragIndex(index)
                            setDropTarget(null)
                          }}
                          onDragOver={after => setDropTarget({ index, after })}
                          onDragEnd={() => {
                            setDragIndex(null)
                            setDropTarget(null)
                          }}
                          onDrop={() => {
                            const from = dragIndex
                            const target = dropTarget
                            setDragIndex(null)
                            setDropTarget(null)
                            if (from !== null && target !== null) {
                              void handleDropAt(from, target.index, target.after)
                            }
                          }}
                          onEdit={() => setEditorTarget({ kind: 'edit', index })}
                          onDuplicate={() => void handleDuplicate(index)}
                          onTest={() => void handleTestCard(index)}
                          onMoveUp={() => void handleMove(index, -1)}
                          onMoveDown={() => void handleMove(index, 1)}
                          onDelete={() => requestDelete(index)}
                        />
                      )
                    })
                  )}
                </div>
              ) : null}

              {/* Section 2: 15 Built-in Preset Providers (Zero-form 1-click activation) */}
              {availableBuiltins.length > 0 ? (
                <div className="space-y-2.5 pt-1">
                  <div>
                    <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      {t('providers.builtinSection', { count: availableBuiltins.length })}
                    </h3>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {t('providers.builtinHint')}
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {availableBuiltins.map(preset => (
                      <BuiltinPresetCard
                        key={preset.id}
                        preset={preset}
                        credential={credentials[preset.id]}
                        busy={busy}
                        onQuickActivate={handleQuickActivatePreset}
                        onOpenFullEditor={handleOpenPresetInFullEditor}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>

      <AlertDialog
        open={pendingDeleteIndex !== null}
        onOpenChange={open => {
          if (!open) setPendingDeleteIndex(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('providers.deleteTitle', { name: pendingDeleteProvider?.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('providers.deleteDesc', {
                count: pendingDeleteProvider?.models?.length ?? 0,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('providers.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmDelete()}>
              {t('settings.remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
