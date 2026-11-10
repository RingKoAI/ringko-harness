import type { ModelDefinition, ProviderDefinition, ProviderFile } from '@/api'
import type { MessageKey } from '@/i18n'

export const TOKEN_FIELDS = ['contextWindow', 'maxInputTokens', 'maxOutputTokens'] as const
export type TokenField = typeof TOKEN_FIELDS[number]
export const TOKEN_LABELS: Record<TokenField, MessageKey> = { contextWindow: 'models.contextWindow', maxInputTokens: 'models.maxInputTokens', maxOutputTokens: 'models.maxOutputTokens' }
export type EditableModel = Omit<ModelDefinition, TokenField> & Partial<Record<TokenField, string | number>>
export type EditableProvider = Omit<ProviderDefinition, 'models'> & { models?: EditableModel[] }
export type EditableProviderFile = Omit<ProviderFile, 'providers'> & { providers?: EditableProvider[] }

export class ModelSettingsError extends Error {
  readonly field: TokenField | 'id' | 'catalogId'
  readonly modelId: string
  readonly reason: 'integer' | 'window' | 'id' | 'mapping'
  constructor(field: ModelSettingsError['field'], modelId: string, reason: ModelSettingsError['reason']) { super(`Invalid ${field} for model ${modelId}.`); this.field = field; this.modelId = modelId; this.reason = reason }
}
export function tokenDraft(value: string | number | undefined): number | undefined {
  if (value === undefined || (typeof value === 'string' && !value.trim())) return undefined
  if (typeof value !== 'string' && typeof value !== 'number') throw new TypeError('Expected a number.')
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) throw new TypeError('Expected a positive integer.')
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError('Expected a positive safe integer.')
  return number
}
export function normalizeModel(model: EditableModel): ModelDefinition {
  if (!model || typeof model.id !== 'string' || !model.id.trim() || model.id.length > 1024) throw new ModelSettingsError('id', model?.id ?? '', 'id')
  const result = { ...model } as ModelDefinition
  if (model.name !== undefined && (typeof model.name !== 'string' || model.name.length > 1024)) throw new ModelSettingsError('id', model.id, 'id')
  result.name = model.name || model.id
  for (const field of TOKEN_FIELDS) {
    let value: number | undefined
    try { value = tokenDraft(model[field]) } catch { throw new ModelSettingsError(field, model.id, 'integer') }
    if (value === undefined) delete result[field]; else result[field] = value
  }
  for (const field of ['maxInputTokens', 'maxOutputTokens'] as const) if (result.contextWindow !== undefined && result[field] !== undefined && result[field] > result.contextWindow) throw new ModelSettingsError(field, model.id, 'window')
  if (result.catalogId !== undefined && typeof result.catalogId !== 'string') throw new ModelSettingsError('catalogId', model.id, 'mapping')
  if (!result.catalogId?.trim()) delete result.catalogId
  else { result.catalogId = result.catalogId.trim(); if (result.catalogId.length > 1024 || !/^[^/]+\/.+$/.test(result.catalogId)) throw new ModelSettingsError('catalogId', model.id, 'mapping') }
  return result
}
export function normalizeProviderFile(file: EditableProviderFile): ProviderFile {
  if (file.providers !== undefined && !Array.isArray(file.providers)) throw new TypeError('Invalid providers array.')
  return { ...file, providers: file.providers?.map(provider => {
    if (!provider || typeof provider !== 'object' || typeof provider.name !== 'string' || (provider.models !== undefined && !Array.isArray(provider.models))) throw new TypeError('Invalid provider model list.')
    const { models, ...rest } = provider
    return { ...rest, ...(models ? { models: models.map(normalizeModel) } : {}) }
  }) }
}
