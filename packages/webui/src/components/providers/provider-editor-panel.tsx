import {
  Activity,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Wand2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import type {
  DiscoveredProviderModel,
  ProviderCredentialStatus,
  ProviderPreset,
} from '@/api'
import { ModelCapacityFields } from '@/components/model-capacity-fields'
import { FetchedModelPicker } from '@/components/providers/fetched-model-picker'
import { ModelReasoningFields } from '@/components/providers/model-reasoning-fields'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import {
  ModelSettingsError,
  TOKEN_LABELS,
  type EditableModel,
  type EditableProvider,
} from '@/lib/model-settings'
import { isOAuthProviderType } from '@/lib/oauth'
import { mergeDiscoveredModels, newModelCount } from '@/lib/provider-models'
import {
  countEnteredKeys,
  dedupeProviderName,
  defaultBaseUrlForPreset,
  filterPresets,
  hasCustomModelLimits,
  parseSingleProviderJson,
  probeProviderModels,
  resolveEndpointPreview,
  serializeSingleProviderJson,
} from '@/lib/provider-workbench'
import { cn } from '@/lib/utils'

const COMMON_TYPES = ['openai-compatible', 'openai', 'anthropic', 'google'] as const

export function ProviderEditorPanel({
  mode,
  initialProvider,
  credentialStatus,
  existingNames,
  presets,
  saving,
  onSave,
  onCancel,
}: {
  mode: 'add' | 'edit'
  initialProvider: EditableProvider
  credentialStatus?: ProviderCredentialStatus
  existingNames: readonly string[]
  presets: readonly ProviderPreset[]
  saving: boolean
  onSave: (provider: EditableProvider) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useI18n()

  const [draft, setDraft] = useState<EditableProvider>(() => ({
    ...initialProvider,
    models: (initialProvider.models ?? []).map(m => ({ ...m })),
  }))
  const [selectedPresetId, setSelectedPresetId] = useState<string>(
    initialProvider.presetId ?? (mode === 'add' ? 'custom' : ''),
  )
  const [presetQuery, setPresetQuery] = useState('')
  const [presetsExpanded, setPresetsExpanded] = useState(
    mode === 'add' && !initialProvider.presetId,
  )

  const [showApiKey, setShowApiKey] = useState(false)
  const [clearSavedKey, setClearSavedKey] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [testing, setTesting] = useState(false)
  const [latencyMs, setLatencyMs] = useState<number | null>(null)
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredProviderModel[] | null>(null)

  const [modelQuery, setModelQuery] = useState('')
  const [expandedModels, setExpandedModels] = useState<Set<number>>(() => new Set())

  const [jsonOpen, setJsonOpen] = useState(false)
  const [singleJson, setSingleJson] = useState(() => serializeSingleProviderJson(initialProvider))

  const isOAuth = isOAuthProviderType(draft.type ?? draft.vendor)
  const activePreset = useMemo(
    () =>
      presets.find(p => p.id === (draft.presetId || selectedPresetId)) ??
      presets.find(p => p.id === draft.name),
    [presets, draft.presetId, selectedPresetId, draft.name],
  )
  const visiblePresets = useMemo(
    () => filterPresets(presets, presetQuery),
    [presets, presetQuery],
  )

  const defaultBaseUrl = defaultBaseUrlForPreset(activePreset)
  const canResetBaseUrl = Boolean(
    activePreset &&
      (activePreset.baseURL
        ? (draft.baseURL ?? '').trim() !== activePreset.baseURL
        : Boolean(draft.baseURL?.trim())),
  )
  const endpointPreview = resolveEndpointPreview(draft.type, draft.baseURL, activePreset)

  const enteredKeyCount = countEnteredKeys(draft.apiKey)
  const hasStoredAuthKey = credentialStatus?.source === 'auth' && !clearSavedKey

  const models = useMemo(() => draft.models ?? [], [draft.models])
  const existingModelIds = useMemo(
    () => new Set(models.map(m => m.id.trim()).filter(Boolean)),
    [models],
  )

  const filteredModelEntries = useMemo(() => {
    const q = modelQuery.trim().toLowerCase()
    return models
      .map((model, index) => ({ model, index }))
      .filter(({ model }) => {
        if (!q) return true
        return model.id.toLowerCase().includes(q) || (model.name ?? '').toLowerCase().includes(q)
      })
  }, [models, modelQuery])

  function updateDraft(updater: (prev: EditableProvider) => EditableProvider): void {
    setDraft(prev => {
      const next = updater(prev)
      if (jsonOpen) setSingleJson(serializeSingleProviderJson(next))
      return next
    })
  }

  function applyPreset(preset: ProviderPreset | 'custom'): void {
    if (preset === 'custom') {
      setSelectedPresetId('custom')
      updateDraft(prev => {
        const next: EditableProvider = {
          ...prev,
          name: dedupeProviderName('custom-provider', existingNames),
          type: 'openai-compatible',
          baseURL: '',
          models: [],
        }
        delete next.presetId
        return next
      })
      return
    }
    setSelectedPresetId(preset.id)
    updateDraft(prev => ({
      ...prev,
      name: dedupeProviderName(preset.id, existingNames),
      presetId: preset.id,
      type: preset.type,
      baseURL: preset.baseURL ?? '',
      models: (preset.defaultModels ?? []).map(m => ({ id: m.id, name: m.name })),
    }))
  }

  function toggleModelExpand(index: number): void {
    setExpandedModels(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  function patchModel(index: number, nextModel: EditableModel): void {
    updateDraft(prev => ({
      ...prev,
      models: (prev.models ?? []).map((entry, idx) => (idx === index ? nextModel : entry)),
    }))
  }

  function removeModel(index: number): void {
    setExpandedModels(prev => {
      const next = new Set<number>()
      for (const item of prev) {
        if (item < index) next.add(item)
        else if (item > index) next.add(item - 1)
      }
      return next
    })
    updateDraft(prev => ({
      ...prev,
      models: (prev.models ?? []).filter((_, idx) => idx !== index),
    }))
  }

  async function handleTestConnectivity(): Promise<void> {
    setTesting(true)
    try {
      const res = await probeProviderModels(draft)
      setLatencyMs(res.latencyMs)
      toast.success(t('providers.testOk', { ms: res.latencyMs, count: res.models.length }))
    } catch (cause) {
      setLatencyMs(null)
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setTesting(false)
    }
  }

  async function handleDiscoverModels(): Promise<void> {
    setDiscovering(true)
    try {
      const res = await probeProviderModels(draft)
      // A picker holding only rows that are already configured cannot add
      // anything, so an all-exists reply stops here instead of opening a dead
      // dialog over the card.
      if (res.models.length === 0 || newModelCount(models, res.models) === 0) {
        toast.info(t('settings.noNewModels'))
        return
      }
      setDiscoveredModels(res.models)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setDiscovering(false)
    }
  }

  function handleAddPickedModels(picked: DiscoveredProviderModel[]): void {
    const added = newModelCount(models, picked)
    updateDraft(prev => ({
      ...prev,
      models: mergeDiscoveredModels(prev.models ?? [], picked),
    }))
    setDiscoveredModels(null)
    if (added > 0) toast.success(t('settings.modelsFetched', { count: added }))
  }

  function reportModelError(cause: unknown): void {
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

  function handleFormatSingleJson(): void {
    try {
      const parsed = JSON.parse(singleJson)
      setSingleJson(JSON.stringify(parsed, null, 2))
    } catch {
      toast.error(t('settings.invalidJson'))
    }
  }

  function handleApplySingleJson(): boolean {
    try {
      const parsed = parseSingleProviderJson(singleJson)
      setDraft(prev => ({
        ...parsed,
        ...(prev.apiKey ? { apiKey: prev.apiKey } : {}),
      }))
      setSingleJson(serializeSingleProviderJson(parsed))
      toast.success(t('providers.jsonApplied'))
      return true
    } catch (cause) {
      if (cause instanceof ModelSettingsError) reportModelError(cause)
      else toast.error(cause instanceof Error ? cause.message : t('settings.invalidJson'))
      return false
    }
  }

  async function handleSubmit(): Promise<void> {
    let candidate = draft
    if (jsonOpen) {
      try {
        const fromJson = parseSingleProviderJson(singleJson)
        candidate = {
          ...fromJson,
          ...(draft.apiKey?.trim() ? { apiKey: draft.apiKey.trim() } : fromJson.apiKey ? { apiKey: fromJson.apiKey } : {}),
        }
      } catch (cause) {
        if (cause instanceof ModelSettingsError) reportModelError(cause)
        else toast.error(cause instanceof Error ? cause.message : t('settings.invalidJson'))
        return
      }
    }

    const trimmedName = candidate.name.trim()
    if (!trimmedName) {
      toast.error(t('providers.emptyNameError'))
      return
    }
    const collision = existingNames.some(n => n.trim().toLowerCase() === trimmedName.toLowerCase())
    if (collision) {
      toast.error(t('providers.duplicateNameError', { name: trimmedName }))
      return
    }

    await onSave({
      ...candidate,
      name: trimmedName,
      enabled: candidate.enabled ?? true,
      ...(clearSavedKey && !candidate.apiKey?.trim() ? { clearApiKey: true } : {}),
      ...(mode === 'edit' && initialProvider.name !== trimmedName
        ? { previousName: initialProvider.name }
        : {}),
      models: (candidate.models ?? []).filter(
        m => m.id.trim().length > 0 || (m.name ?? '').trim().length > 0,
      ),
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
            <ArrowLeft data-icon="inline-start" className="size-4" />
            {t('providers.backToList')}
          </Button>
          <span className="text-muted-foreground">/</span>
          <h2 className="truncate text-sm font-semibold">
            {mode === 'add'
              ? t('providers.addTitle')
              : t('providers.editTitle', { name: initialProvider.name })}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={saving}>
            {t('providers.cancel')}
          </Button>
          <Button type="button" size="sm" onClick={() => void handleSubmit()} disabled={saving}>
            {saving ? <LoaderCircle data-icon="inline-start" className="size-3.5 animate-spin" /> : null}
            {t('providers.saveProvider')}
          </Button>
        </div>
      </div>

      {/* 15 Built-in Preset selector grid (Add mode, collapsible) */}
      {mode === 'add' && presets.length > 0 ? (
        <Card>
          <CardHeader className="py-3">
            <button
              type="button"
              onClick={() => setPresetsExpanded(prev => !prev)}
              className="flex w-full items-center justify-between text-left"
            >
              <CardTitle className="text-sm">{t('providers.presetSection')}</CardTitle>
              <ChevronDown
                className={cn(
                  'size-4 text-muted-foreground transition-transform',
                  !presetsExpanded && '-rotate-90',
                )}
              />
            </button>
          </CardHeader>
          {presetsExpanded ? (
            <CardContent className="space-y-3 pt-0">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={presetQuery}
                  onChange={event => setPresetQuery(event.target.value)}
                  placeholder={t('providers.presetSearch')}
                  className="h-8 pl-8 text-xs"
                />
              </div>

              <div className="grid max-h-48 grid-cols-2 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-3 md:grid-cols-4">
                <button
                  type="button"
                  onClick={() => applyPreset('custom')}
                  className={cn(
                    'flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium transition-colors',
                    selectedPresetId === 'custom'
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'hover:bg-accent/60',
                  )}
                >
                  <span className="truncate">{t('providers.presetCustom')}</span>
                </button>
                {visiblePresets.map(preset => {
                  const selected = selectedPresetId === preset.id
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className={cn(
                        'flex items-center justify-between gap-1 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors',
                        selected
                          ? 'border-primary bg-primary/10 font-medium text-foreground'
                          : 'hover:bg-accent/60',
                      )}
                    >
                      <span className="truncate">{preset.label}</span>
                    </button>
                  )
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                <span>
                  {activePreset?.apiKeyEnv
                    ? t('providers.presetEnvHint', { env: activePreset.apiKeyEnv })
                    : t('providers.presetCustomHint')}
                </span>
                {(activePreset?.apiKeyUrl ?? activePreset?.docs) ? (
                  <a
                    href={activePreset.apiKeyUrl ?? activePreset.docs}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                  >
                    {t('providers.getApiKey')}
                    <ExternalLink className="size-3" />
                  </a>
                ) : null}
              </div>
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      {/* Endpoint & Credentials */}
      {!isOAuth ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between py-3">
            <CardTitle className="text-sm">{t('providers.basicSection')}</CardTitle>
            <div className="flex items-center gap-2">
              {latencyMs !== null ? (
                <Badge
                  variant="outline"
                  className="border-emerald-500/40 bg-emerald-500/10 font-mono text-[10px] text-emerald-600 dark:text-emerald-400"
                >
                  {latencyMs} ms
                </Badge>
              ) : null}
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={testing || saving}
                onClick={() => void handleTestConnectivity()}
              >
                {testing ? (
                  <LoaderCircle data-icon="inline-start" className="size-3 animate-spin" />
                ) : (
                  <Activity data-icon="inline-start" className="size-3" />
                )}
                {testing ? t('providers.testing') : t('providers.test')}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">{t('settings.providerName')}</span>
                <Input
                  value={draft.name}
                  onChange={event => updateDraft(prev => ({ ...prev, name: event.target.value }))}
                  placeholder={t('settings.providerName')}
                  className="font-medium"
                />
              </label>

              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">{t('settings.providerType')}</span>
                <Input
                  value={draft.type ?? ''}
                  onChange={event => updateDraft(prev => ({ ...prev, type: event.target.value }))}
                  placeholder="openai-compatible"
                  list="ringko-editor-provider-types"
                  className="font-mono text-xs"
                />
                <datalist id="ringko-editor-provider-types">
                  {COMMON_TYPES.map(tp => (
                    <option key={tp} value={tp} />
                  ))}
                </datalist>
              </label>
            </div>

            <div className="flex flex-wrap gap-1">
              {COMMON_TYPES.map(tp => (
                <button
                  key={tp}
                  type="button"
                  onClick={() => updateDraft(prev => ({ ...prev, type: tp }))}
                  className={cn(
                    'rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors',
                    (draft.type || 'openai-compatible') === tp
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tp}
                </button>
              ))}
            </div>

            <div className="space-y-1 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{t('settings.baseUrl')}</span>
                {canResetBaseUrl ? (
                  <button
                    type="button"
                    onClick={() =>
                      updateDraft(prev => ({
                        ...prev,
                        baseURL: activePreset?.baseURL ?? '',
                      }))
                    }
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                  >
                    <RotateCcw className="size-3" />
                    {t('providers.resetBaseUrl')}
                  </button>
                ) : null}
              </div>
              <Input
                value={draft.baseURL ?? ''}
                onChange={event => updateDraft(prev => ({ ...prev, baseURL: event.target.value }))}
                placeholder={defaultBaseUrl || 'https://api.example.com/v1'}
                className="font-mono text-xs"
              />
              {endpointPreview ? (
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {t('providers.endpointPreview', { url: endpointPreview })}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span>{t('settings.apiKey')}</span>
                  {enteredKeyCount > 1 ? (
                    <Badge variant="secondary" className="text-[10px]">
                      {t('providers.multiKeyDetected', { count: enteredKeyCount })}
                    </Badge>
                  ) : null}
                </span>
                <div className="flex items-center gap-2">
                  {hasStoredAuthKey ? (
                    <button
                      type="button"
                      onClick={() => setClearSavedKey(true)}
                      className="text-[11px] text-destructive hover:underline"
                    >
                      {t('providers.clearStoredKey')}
                    </button>
                  ) : null}
                  {(activePreset?.apiKeyUrl ?? activePreset?.docs) ? (
                    <a
                      href={activePreset.apiKeyUrl ?? activePreset.docs}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline"
                    >
                      {t('providers.getApiKey')}
                      <ExternalLink className="size-2.5" />
                    </a>
                  ) : null}
                </div>
              </div>

              {showApiKey ? (
                <div className="relative">
                  <Textarea
                    value={draft.apiKey ?? ''}
                    onChange={event => {
                      setClearSavedKey(false)
                      updateDraft(prev => ({ ...prev, apiKey: event.target.value }))
                    }}
                    placeholder={
                      activePreset?.apiKeyEnv
                        ? `$${activePreset.apiKeyEnv} / sk-key1, sk-key2`
                        : t('providers.quickKeyPlaceholder')
                    }
                    rows={2}
                    spellCheck={false}
                    className="pr-9 font-mono text-xs"
                  />
                  <button
                    type="button"
                    aria-label={t('providers.hideKey')}
                    title={t('providers.hideKey')}
                    onClick={() => setShowApiKey(false)}
                    className="absolute top-2 right-2 rounded p-1 text-muted-foreground hover:text-foreground"
                  >
                    <EyeOff className="size-3.5" />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Input
                    type="password"
                    autoComplete="off"
                    value={draft.apiKey ?? ''}
                    onChange={event => {
                      setClearSavedKey(false)
                      updateDraft(prev => ({ ...prev, apiKey: event.target.value }))
                    }}
                    placeholder={
                      hasStoredAuthKey
                        ? `•••••••• (${credentialStatus?.keyCount ?? 1})`
                        : activePreset?.apiKeyEnv
                          ? `$${activePreset.apiKeyEnv}`
                          : t('providers.quickKeyPlaceholder')
                    }
                    className="pr-9 font-mono text-xs"
                  />
                  <button
                    type="button"
                    aria-label={t('providers.showKey')}
                    title={t('providers.showKey')}
                    onClick={() => setShowApiKey(true)}
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                  >
                    <Eye className="size-3.5" />
                  </button>
                </div>
              )}

              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {clearSavedKey
                  ? t('providers.keyClearedPending')
                  : hasStoredAuthKey && !draft.apiKey
                    ? t('providers.storedKeyKeepHint', { count: credentialStatus?.keyCount ?? 1 })
                    : t('providers.multiKeyHint')}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Models Workbench */}
      <Card>
        <CardHeader className="flex-col items-stretch justify-between gap-2 py-3 sm:flex-row sm:items-center">
          <CardTitle className="text-sm">
            {t('providers.modelsSection', { count: models.length })}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            {models.length > 0 ? (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => {
                  if (expandedModels.size > 0) setExpandedModels(new Set())
                  else setExpandedModels(new Set(models.map((_, idx) => idx)))
                }}
              >
                {expandedModels.size > 0
                  ? t('providers.collapseAllModels')
                  : t('providers.expandAllModels')}
              </Button>
            ) : null}
            {!isOAuth && models.length > 1 ? (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => {
                  setExpandedModels(new Set())
                  updateDraft(prev => ({ ...prev, models: [] }))
                }}
              >
                {t('providers.clearModels')}
              </Button>
            ) : null}
            {!isOAuth ? (
              <>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={discovering || saving}
                  onClick={() => void handleDiscoverModels()}
                >
                  <RefreshCw
                    data-icon="inline-start"
                    className={cn('size-3', discovering && 'animate-spin')}
                  />
                  {discovering ? t('settings.fetchingModels') : t('settings.fetchModels')}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={saving}
                  onClick={() =>
                    updateDraft(prev => ({
                      ...prev,
                      models: [...(prev.models ?? []), { id: '', name: '' }],
                    }))
                  }
                >
                  <Plus data-icon="inline-start" className="size-3" />
                  {t('settings.addModel')}
                </Button>
              </>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="space-y-3 pt-0">
          {discoveredModels ? (
            <FetchedModelPicker
              discovered={discoveredModels}
              existingIds={existingModelIds}
              onAddSelected={handleAddPickedModels}
              onClose={() => setDiscoveredModels(null)}
            />
          ) : null}

          {models.length > 4 ? (
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={modelQuery}
                onChange={event => setModelQuery(event.target.value)}
                placeholder={t('providers.modelSearch')}
                className="h-8 pl-8 text-xs"
              />
            </div>
          ) : null}

          {models.length === 0 ? (
            <p className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">
              {t('providers.noModelsYet')}
            </p>
          ) : (
            <div className="space-y-2">
              {filteredModelEntries.map(({ model, index }) => {
                const isExpanded = expandedModels.has(index)
                const customized = hasCustomModelLimits(model)
                return (
                  <div key={index} className="rounded-lg border bg-background/60 p-2">
                    <div className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-expanded={isExpanded}
                        aria-label={t('models.capacityTitle')}
                        onClick={() => toggleModelExpand(index)}
                      >
                        <ChevronRight
                          className={cn('size-3.5 transition-transform', isExpanded && 'rotate-90')}
                        />
                      </Button>

                      <Input
                        value={model.id}
                        readOnly={isOAuth}
                        onChange={event => patchModel(index, { ...model, id: event.target.value })}
                        placeholder={t('settings.modelId')}
                        aria-label={t('settings.modelId')}
                        className="h-8 flex-1 font-mono text-xs"
                      />

                      <Input
                        value={model.name ?? ''}
                        readOnly={isOAuth}
                        onChange={event => patchModel(index, { ...model, name: event.target.value })}
                        placeholder={t('settings.modelName')}
                        aria-label={t('settings.modelName')}
                        className="hidden h-8 flex-1 text-xs sm:block"
                      />

                      {customized ? (
                        <Badge variant="secondary" className="hidden shrink-0 text-[10px] md:inline-flex">
                          {t('providers.customLimits')}
                        </Badge>
                      ) : null}

                      {!isOAuth ? (
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`${t('settings.remove')} ${model.name || model.id}`}
                          onClick={() => removeModel(index)}
                        >
                          <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                        </Button>
                      ) : null}
                    </div>

                    {isExpanded ? (
                      <div className="mt-2 ml-6 space-y-3 border-l-2 border-muted pl-3">
                        <ModelCapacityFields
                          provider={draft}
                          model={model}
                          onChange={next => patchModel(index, next)}
                        />
                        <ModelReasoningFields
                          model={model}
                          disabled={isOAuth}
                          onChange={next => patchModel(index, next)}
                        />
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Single-Provider Raw JSON Accordion */}
      {!isOAuth ? (
        <Card>
          <CardHeader className="py-3">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!jsonOpen) setSingleJson(serializeSingleProviderJson(draft))
                  setJsonOpen(prev => !prev)
                }}
                className="flex items-center gap-1.5 text-left text-sm font-medium"
              >
                <ChevronRight className={cn('size-4 transition-transform', jsonOpen && 'rotate-90')} />
                <span>{t('providers.singleJsonSection')}</span>
              </button>

              {jsonOpen ? (
                <div className="flex items-center gap-1.5">
                  <Button type="button" size="xs" variant="ghost" onClick={handleFormatSingleJson}>
                    <Wand2 data-icon="inline-start" className="size-3" />
                    {t('providers.formatJson')}
                  </Button>
                  <Button type="button" size="xs" variant="outline" onClick={() => void handleApplySingleJson()}>
                    {t('providers.applyJson')}
                  </Button>
                </div>
              ) : null}
            </div>
          </CardHeader>
          {jsonOpen ? (
            <CardContent className="pt-0">
              <Textarea
                value={singleJson}
                onChange={event => setSingleJson(event.target.value)}
                spellCheck={false}
                className="min-h-48 font-mono text-xs"
              />
            </CardContent>
          ) : null}
        </Card>
      ) : null}
    </div>
  )
}
