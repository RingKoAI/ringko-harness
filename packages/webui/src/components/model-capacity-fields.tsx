import { useEffect, useId, useRef, useState } from 'react'
import { previewModelContext, type ModelContextPreview } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { TOKEN_FIELDS, TOKEN_LABELS, tokenDraft, type EditableModel, type EditableProvider } from '@/lib/model-settings'
const LOOKUP_TIMEOUT_MS = 10_000

export function ModelCapacityFields({ provider, model, onChange }: { provider: EditableProvider; model: EditableModel; onChange: (model: EditableModel) => void }) {
  const { t, locale } = useI18n()
  const id = useId()
  const request = { provider: { name: provider.name, type: provider.type, vendor: provider.vendor, baseURL: provider.baseURL, url: provider.url }, model: { id: model.id, name: model.id, ...(model.catalogId?.trim() ? { catalogId: model.catalogId.trim() } : {}) } }
  const key = JSON.stringify(request)
  const active = useRef<AbortController | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [result, setResult] = useState<{ key: string; value: ModelContextPreview }>()
  const [failure, setFailure] = useState<{ key: string; message: string }>()
  const preview = result?.key === key ? result.value : undefined
  useEffect(() => () => active.current?.abort(), [])

  async function lookup(): Promise<void> {
    active.current?.abort()
    const controller = new AbortController(); active.current = controller
    setLoading(key); setFailure(undefined)
    try {
      const value = await previewModelContext(request, AbortSignal.any([controller.signal, AbortSignal.timeout(LOOKUP_TIMEOUT_MS)]))
      if (!controller.signal.aborted) setResult({ key, value })
    } catch (cause) {
      if (!controller.signal.aborted) setFailure({ key, message: cause instanceof Error ? cause.message : String(cause) })
    } finally { if (active.current === controller) { active.current = null; setLoading(null) } }
  }
  const number = (value?: number) => value === undefined ? t('models.unknown') : value.toLocaleString(locale)
  const automatic = preview ? { contextWindow: preview.automatic.contextWindow, maxInputTokens: preview.automatic.maxInputTokens, maxOutputTokens: preview.automatic.reserveOutputTokens } : undefined
  return (
    <section aria-labelledby={`${id}-title`} className="min-w-0 space-y-3 pt-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={`${id}-title`} className="text-xs font-medium">{t('models.capacityTitle')}</h4>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" disabled={!model.id.trim() || !provider.name.trim() || loading === key} onClick={() => void lookup()}>{loading === key ? t('models.loading') : t('models.lookup')}</Button>
          <Button size="sm" variant="ghost" onClick={() => { const next = { ...model }; for (const field of TOKEN_FIELDS) delete next[field]; onChange(next) }}>{t('models.restoreAuto')}</Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {TOKEN_FIELDS.map(field => {
          let invalid = false
          try { tokenDraft(model[field]) } catch { invalid = true }
          return <label key={field} className="min-w-0 space-y-1 text-xs" htmlFor={`${id}-${field}`}>
            <span id={`${id}-${field}-label`}>{t(TOKEN_LABELS[field])}</span>
            <Input id={`${id}-${field}`} inputMode="numeric" value={model[field] ?? ''} aria-labelledby={`${id}-${field}-label`} aria-invalid={invalid} aria-describedby={invalid ? `${id}-${field}-error` : `${id}-hint`} placeholder={automatic?.[field] !== undefined ? t('models.autoValue', { value: number(automatic[field]) }) : t('models.auto')} onChange={event => onChange({ ...model, [field]: event.target.value })} />
            {invalid && <span id={`${id}-${field}-error`} className="block text-destructive">{t('models.integerHint')}</span>}
          </label>
        })}
      </div>
      <p id={`${id}-hint`} className="text-xs leading-relaxed text-muted-foreground">{t('models.capacityHint')}</p>
      <label className="block space-y-1 text-xs" htmlFor={`${id}-catalog`}>
        <span id={`${id}-catalog-label`}>{t('models.catalogId')}</span>
        <Input id={`${id}-catalog`} value={model.catalogId ?? ''} placeholder="provider/model" aria-labelledby={`${id}-catalog-label`} aria-describedby={`${id}-catalog-hint`} onChange={event => onChange({ ...model, catalogId: event.target.value })} className="font-mono text-xs" />
        <span id={`${id}-catalog-hint`} className="block text-muted-foreground">{t('models.catalogHint')}</span>
      </label>
      {preview && <p role="status" className="break-words text-xs leading-relaxed text-muted-foreground">{preview.metadata ? t('models.catalogLimits', { context: number(preview.metadata.limit.context), input: number(preview.metadata.limit.input), output: number(preview.metadata.limit.output) }) : t('models.noMetadata', { context: number(preview.automatic.contextWindow), output: number(preview.automatic.reserveOutputTokens) })}</p>}
      {failure?.key === key && <p role="alert" className="break-words text-xs text-destructive">{t('models.lookupFailed', { message: failure.message })}</p>}
    </section>
  )
}
