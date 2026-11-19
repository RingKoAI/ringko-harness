import {
  discoverProviderModels,
  type DiscoveredProviderModel,
  type ProviderCredentialStatus,
  type ProviderPreset,
} from '@/api'
import { normalizeModel, TOKEN_FIELDS, type EditableModel, type EditableProvider } from './model-settings'

export async function probeProviderModels(provider: {
  name: string
  presetId?: string
  type?: string
  baseURL?: string
  apiKey?: string
}): Promise<{ models: DiscoveredProviderModel[]; latencyMs: number }> {
  const started = performance.now()
  const res = await discoverProviderModels({
    name: provider.name.trim() || 'provider',
    ...(provider.presetId ? { presetId: provider.presetId } : {}),
    type: provider.type?.trim() || 'openai-compatible',
    ...(provider.baseURL?.trim() ? { baseURL: provider.baseURL.trim() } : {}),
    ...(provider.apiKey?.trim() ? { apiKey: provider.apiKey.trim() } : {}),
  })
  const latencyMs = Math.max(1, Math.round(performance.now() - started))
  return { models: res.models, latencyMs }
}

/** Count distinct non-empty API keys in a comma- or newline-separated input string. */
export function countEnteredKeys(raw: string | undefined): number {
  if (!raw) return 0
  const unique = new Set(
    raw
      .split(/[\r\n,]+/)
      .map(token => token.trim())
      .filter(token => token.length > 0),
  )
  return unique.size
}

/** Canonical default Base URL for a preset (either explicit `baseURL` or display `defaultBaseURL`). */
export function defaultBaseUrlForPreset(preset: ProviderPreset | undefined): string {
  return preset?.baseURL ?? preset?.defaultBaseURL ?? ''
}

/** Compute a human-readable upstream request endpoint preview to prevent `/v1/v1` mistakes. */
export function resolveEndpointPreview(
  type: string | undefined,
  baseURL: string | undefined,
  preset?: ProviderPreset,
): string | null {
  const effectiveType = (type || preset?.type || 'openai-compatible').trim().toLowerCase()
  const rawBase = (baseURL?.trim() || preset?.baseURL || preset?.defaultBaseURL || '').replace(/\/+$/, '')
  if (!rawBase) {
    if (effectiveType === 'openai') return 'POST https://api.openai.com/v1/responses'
    if (effectiveType === 'anthropic') return 'POST https://api.anthropic.com/v1/messages'
    if (effectiveType === 'google') return 'POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
    return null
  }
  if (effectiveType === 'anthropic') {
    const suffix = rawBase.endsWith('/v1') ? '/messages' : '/v1/messages'
    return `POST ${rawBase}${suffix}`
  }
  if (effectiveType === 'google') {
    return `POST ${rawBase}/models/{model}:generateContent`
  }
  return `POST ${rawBase}/chat/completions`
}

/** Extract the active provider name from a `<provider>/<model>` identifier. */
export function activeProviderName(activeModelId: string | null | undefined): string | null {
  if (!activeModelId) return null
  const slash = activeModelId.indexOf('/')
  return slash > 0 ? activeModelId.slice(0, slash) : null
}

/** Extract the active model ID within `providerName`, or null when another provider is active. */
export function activeModelShortId(activeModelId: string | null | undefined, providerName: string): string | null {
  if (!activeModelId || !providerName) return null
  const prefix = `${providerName}/`
  return activeModelId.startsWith(prefix) ? activeModelId.slice(prefix.length) : null
}

/** Generate a non-colliding provider name (`deepseek` -> `deepseek-2`, `openai-copy` -> `openai-copy-2`). */
export function dedupeProviderName(desiredName: string, existingNames: readonly string[]): string {
  const base = desiredName.trim() || 'provider'
  const lowerSet = new Set(existingNames.map(name => name.trim().toLowerCase()))
  if (!lowerSet.has(base.toLowerCase())) return base
  let suffix = 2
  while (lowerSet.has(`${base}-${suffix}`.toLowerCase())) {
    suffix += 1
  }
  return `${base}-${suffix}`
}

/**
 * Move one provider to the position a drag-and-drop drop names: `to` is the
 * card index and `after` says which half of it received the drop. Returns
 * `undefined` when the move would leave the list unchanged.
 */
export function reorderProviders<T>(items: readonly T[], from: number, to: number, after: boolean): T[] | undefined {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length) return undefined
  let target = after ? to + 1 : to
  if (from < target) target -= 1
  if (target === from) return undefined
  const next = [...items]
  const [moved] = next.splice(from, 1)
  if (moved === undefined) return undefined
  next.splice(target, 0, moved)
  return next
}

/** Deep-clone a provider with a `-copy` suffix for multi-account / gateway duplication. */
export function cloneProvider(provider: EditableProvider, existingNames: readonly string[]): EditableProvider {
  const baseCopyName = provider.name.endsWith('-copy') ? provider.name : `${provider.name}-copy`
  const nextName = dedupeProviderName(baseCopyName, existingNames)
  const { apiKey: _omitInline, clearApiKey: _omitClear, previousName: _omitPrev, ...rest } = provider
  void _omitInline
  void _omitClear
  void _omitPrev
  return {
    ...rest,
    name: nextName,
    ...(provider.presetId ? { presetId: provider.presetId } : {}),
    enabled: provider.enabled ?? true,
    ...(provider.models ? { models: provider.models.map(model => ({ ...model })) } : {}),
  }
}

/** Build a ready-to-save `EditableProvider` from one of the 15 built-in presets. */
export function buildQuickActivatedProvider(
  preset: ProviderPreset,
  rawApiKey?: string,
): EditableProvider {
  const trimmedKey = rawApiKey?.trim() ?? ''
  return {
    name: preset.id,
    presetId: preset.id,
    enabled: true,
    type: preset.type,
    ...(preset.baseURL ? { baseURL: preset.baseURL } : {}),
    ...(trimmedKey ? { apiKey: trimmedKey } : {}),
    models: (preset.defaultModels ?? []).map(model => ({
      id: model.id,
      name: model.name,
    })),
  }
}

/** Return built-in presets not yet configured, sorting env-ready and local presets first. */
export function unconfiguredBuiltinPresets(
  builtinPresets: readonly ProviderPreset[],
  configuredProviders: readonly EditableProvider[],
  credentials: Record<string, ProviderCredentialStatus> | undefined,
  query: string,
): ProviderPreset[] {
  const configuredIds = new Set<string>()
  for (const provider of configuredProviders) {
    configuredIds.add(provider.name.toLowerCase())
    if (provider.presetId) configuredIds.add(provider.presetId.toLowerCase())
  }
  const normalizedQuery = query.trim().toLowerCase()
  const remaining = builtinPresets.filter(preset => {
    if (configuredIds.has(preset.id.toLowerCase())) return false
    if (!normalizedQuery) return true
    const haystack = [
      preset.id,
      preset.label,
      preset.type,
      preset.baseURL ?? '',
      preset.defaultBaseURL ?? '',
      preset.apiKeyEnv ?? '',
      ...(preset.defaultModels ?? []).map(m => m.id),
    ]
      .join('\n')
      .toLowerCase()
    return haystack.includes(normalizedQuery)
  })

  return [...remaining].sort((a, b) => {
    const credA = credentials?.[a.id]
    const credB = credentials?.[b.id]
    const readyA = Boolean(credA?.envDetected || credA?.source === 'local' || credA?.source === 'auth')
    const readyB = Boolean(credB?.envDetected || credB?.source === 'local' || credB?.source === 'auth')
    if (readyA !== readyB) return readyA ? -1 : 1
    return 0
  })
}

/** Return indices of providers matching a case-insensitive search query across name, URL, type, and models. */
export function filterProviderIndices(providers: readonly EditableProvider[], query: string): number[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return providers.map((_, index) => index)
  const matches: number[] = []
  providers.forEach((provider, index) => {
    const haystack = [
      provider.name,
      provider.presetId ?? '',
      provider.type ?? '',
      provider.vendor ?? '',
      provider.baseURL ?? '',
      provider.url ?? '',
      ...(provider.models ?? []).flatMap(model => [model.id, model.name ?? '']),
    ]
      .join('\n')
      .toLowerCase()
    if (haystack.includes(normalized)) matches.push(index)
  })
  return matches
}

/** Filter the 15 built-in presets by keyword across id, label, type, baseURL, and env var. */
export function filterPresets(presets: readonly ProviderPreset[], query: string): ProviderPreset[] {
  const normalized = query.trim().toLowerCase()
  const builtins = presets.filter(preset => preset.id !== 'custom')
  if (!normalized) return [...builtins]
  return builtins.filter(preset => {
    const haystack = [
      preset.id,
      preset.label,
      preset.type,
      preset.baseURL ?? '',
      preset.defaultBaseURL ?? '',
      preset.apiKeyEnv ?? '',
    ]
      .join('\n')
      .toLowerCase()
    return haystack.includes(normalized)
  })
}

/** Whether a model has any explicit token limit or catalog mapping configured. */
export function hasCustomModelLimits(model: EditableModel): boolean {
  for (const field of TOKEN_FIELDS) {
    const val = model[field]
    if (val !== undefined && String(val).trim().length > 0) return true
  }
  return Boolean(model.catalogId && model.catalogId.trim().length > 0)
}

/** Serialize a single editable provider to clean JSON (never exporting raw secrets unless typed inline). */
export function serializeSingleProviderJson(provider: EditableProvider): string {
  const clean: Record<string, unknown> = {
    name: provider.name,
    ...(provider.presetId ? { presetId: provider.presetId } : {}),
    ...(provider.enabled === false ? { enabled: false } : {}),
    ...(provider.type ? { type: provider.type } : {}),
    ...(provider.vendor ? { vendor: provider.vendor } : {}),
    ...(provider.baseURL ? { baseURL: provider.baseURL } : {}),
    ...(provider.url ? { url: provider.url } : {}),
    ...(provider.module ? { module: provider.module } : {}),
    models: (provider.models ?? []).map(model => ({ ...model })),
  }
  return JSON.stringify(clean, null, 2)
}

/** Validate and parse a single provider JSON object back into an `EditableProvider`. */
export function parseSingleProviderJson(text: string): EditableProvider {
  const parsed: unknown = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('Provider JSON must be an object.')
  }
  const record = parsed as Record<string, unknown>
  if (typeof record.name !== 'string' || !record.name.trim()) {
    throw new TypeError('Provider "name" is required.')
  }
  if (record.models !== undefined && !Array.isArray(record.models)) {
    throw new TypeError('"models" must be an array.')
  }
  const normalizedModels = Array.isArray(record.models)
    ? record.models.map(entry => normalizeModel(entry as EditableModel))
    : []

  const result: EditableProvider = {
    name: record.name.trim(),
    models: normalizedModels,
  }
  if (typeof record.presetId === 'string' && record.presetId.trim()) result.presetId = record.presetId.trim()
  if (typeof record.enabled === 'boolean') result.enabled = record.enabled
  if (typeof record.type === 'string' && record.type.trim()) result.type = record.type.trim()
  if (typeof record.vendor === 'string' && record.vendor.trim()) result.vendor = record.vendor.trim()
  if (typeof record.baseURL === 'string' && record.baseURL.trim()) result.baseURL = record.baseURL.trim()
  if (typeof record.url === 'string' && record.url.trim()) result.url = record.url.trim()
  if (typeof record.apiKey === 'string' && record.apiKey.trim()) result.apiKey = record.apiKey.trim()
  if (typeof record.module === 'string' && record.module.trim()) result.module = record.module.trim()
  return result
}
