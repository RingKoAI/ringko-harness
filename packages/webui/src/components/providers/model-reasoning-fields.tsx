import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import { REASONING_LEVELS, REASONING_VALUE_LIMIT, type EditableModel } from '@/lib/model-settings'

/**
 * Per-level override of the reasoning value a model sends upstream. Each row
 * pairs a thinking level with the string the provider receives for it; a level
 * left out of the map keeps the provider's default mapping, so removing every
 * row removes the field rather than disabling reasoning.
 */
export function ModelReasoningFields({
  model,
  disabled = false,
  onChange,
}: {
  model: EditableModel
  disabled?: boolean
  onChange: (model: EditableModel) => void
}) {
  const { t } = useI18n()
  const entries = Object.entries(model.reasoningEfforts ?? {})
  const used = entries.map(([level]) => level)
  const custom = used.filter(level => !(REASONING_LEVELS as readonly string[]).includes(level))
  const choices = [...REASONING_LEVELS, ...custom]
  const nextLevel = choices.find(level => !used.includes(level))

  function write(next: Array<[string, string]>): void {
    if (next.length === 0) {
      const cleared = { ...model }
      delete cleared.reasoningEfforts
      onChange(cleared)
      return
    }
    onChange({ ...model, reasoningEfforts: Object.fromEntries(next) })
  }

  function changeLevel(index: number, level: string): void {
    write(entries.map((entry, at) => at === index ? [level, level] : entry))
  }

  function changeValue(index: number, value: string): void {
    write(entries.map((entry, at) => at === index ? [entry[0], value] : entry))
  }

  const invalid = entries.some(([, value]) => value.trim().length === 0)

  return (
    <section className="min-w-0 space-y-2 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-xs font-medium">{t('models.reasoningTitle')}</h4>
          <p className="text-xs leading-relaxed text-muted-foreground">{t('models.reasoningHint')}</p>
        </div>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={disabled || nextLevel === undefined}
          onClick={() => { if (nextLevel !== undefined) write([...entries, [nextLevel, nextLevel]]) }}
        >
          <Plus data-icon="inline-start" className="size-3" />
          {t('models.reasoningAdd')}
        </Button>
      </div>

      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('models.reasoningEmpty')}</p>
      ) : (
        <div className="space-y-1.5">
          {entries.map(([level, value], index) => (
            <div key={`${level}-${index}`} className="flex items-center gap-2">
              <Select value={level} onValueChange={next => changeLevel(index, next)} disabled={disabled}>
                <SelectTrigger aria-label={t('models.reasoningLevel')} className="h-8 w-32 shrink-0 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {choices.map(choice => (
                    <SelectItem key={choice} value={choice} disabled={choice !== level && used.includes(choice)}>
                      {choice}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={value}
                maxLength={REASONING_VALUE_LIMIT}
                disabled={disabled}
                aria-label={`${level} ${t('models.reasoningValue')}`}
                aria-invalid={value.trim().length === 0}
                placeholder={level}
                onChange={event => changeValue(index, event.target.value)}
                className="h-8 flex-1 font-mono text-xs"
              />
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                disabled={disabled}
                aria-label={`${t('models.reasoningRemove')} ${level}`}
                onClick={() => write(entries.filter((_entry, at) => at !== index))}
              >
                <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
              </Button>
            </div>
          ))}
          {invalid ? <p className="text-xs text-destructive">{t('models.reasoningValueRequired')}</p> : null}
        </div>
      )}
    </section>
  )
}
