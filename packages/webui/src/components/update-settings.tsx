import { useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import { setUpdates, type Info } from '@/api'
import { Checkbox } from '@/components/ui/checkbox'
import { useI18n } from '@/i18n'
import { useApp } from '@/store'

export function UpdateSettings() {
  const { t } = useI18n()
  const app = useApp()
  const id = useId()
  const remote = app.info?.updates
  const [saved, setSaved] = useState<{ source: typeof remote; value: Info['updates'] }>()
  const preferences = saved && saved.source === remote ? saved.value : remote
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [error, setError] = useState<string | null>(null)

  async function save(key: keyof Info['updates'], checked: boolean): Promise<void> {
    if (pending.current || !preferences) return
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      const info = await setUpdates({ [key]: checked })
      setSaved({ source: remote, value: info.updates })
      app.refreshInfo()
      toast.success(t('settings.saved'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { pending.current = false; setBusy(false) }
  }

  return (
    <section aria-labelledby={`${id}-title`} aria-busy={busy} className="py-4">
      <h3 id={`${id}-title`} className="text-sm font-medium">{t('updates.title')}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{t('updates.hint')}</p>
      <label htmlFor={`${id}-check`} className="flex min-h-11 cursor-pointer items-start justify-between gap-4 py-3">
        <span className="min-w-0 space-y-1">
          <span id={`${id}-check-label`} className="block text-sm">{t('updates.checkOnStartup')}</span>
          <span id={`${id}-check-hint`} className="block text-xs leading-relaxed text-muted-foreground">{t('updates.checkOnStartupHint')}</span>
        </span>
        <Checkbox id={`${id}-check`} aria-labelledby={`${id}-check-label`} aria-describedby={`${id}-check-hint`} className="mt-0.5" checked={preferences?.checkOnStartup ?? false} disabled={busy || !preferences} onCheckedChange={checked => void save('checkOnStartup', checked === true)} />
      </label>
      <label htmlFor={`${id}-auto`} className="flex min-h-11 cursor-pointer items-start justify-between gap-4 py-3">
        <span className="min-w-0 space-y-1">
          <span id={`${id}-auto-label`} className="block text-sm">{t('updates.autoUpdate')}</span>
          <span id={`${id}-auto-hint`} className="block text-xs leading-relaxed text-muted-foreground">{t('updates.autoUpdateHint')}</span>
          {preferences && !preferences.checkOnStartup && <span id={`${id}-auto-disabled`} className="block text-xs text-muted-foreground">{t('updates.requiresCheck')}</span>}
        </span>
        <Checkbox id={`${id}-auto`} aria-labelledby={`${id}-auto-label`} aria-describedby={`${id}-auto-hint${preferences && !preferences.checkOnStartup ? ` ${id}-auto-disabled` : ''}`} className="mt-0.5" checked={preferences?.autoUpdate ?? false} disabled={busy || !preferences?.checkOnStartup} onCheckedChange={checked => void save('autoUpdate', checked === true)} />
      </label>
      {busy && <p role="status" className="text-xs text-muted-foreground">{t('updates.saving')}</p>}
      {error && <p role="alert" className="break-words text-sm text-destructive">{t('updates.saveFailed', { message: error })}</p>}
    </section>
  )
}
