import { useState } from 'react'
import { Check, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { setPermissionPreset, type AccessMode, type PermissionPreset } from '@/api'
import { Button } from '@/components/ui/button'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useI18n, type MessageKey } from '@/i18n'
import { useApp } from '@/store'

const MODES: { value: PermissionPreset; label: MessageKey; description: MessageKey }[] = [
  { value: 'read-only', label: 'access.readOnly', description: 'access.readOnly.desc' },
  { value: 'default', label: 'access.default', description: 'access.default.desc' },
  { value: 'full-access', label: 'access.full', description: 'access.full.desc' },
]

/** Switching into full access is a security boundary and needs a second confirmation. */
export function requiresFullAccessConfirmation(current: AccessMode, next: AccessMode): boolean {
  return next === 'full' && current !== 'full'
}

export function AccessPicker() {
  const { t } = useI18n()
  const app = useApp()
  const current = app.info?.permissionPreset ?? 'custom'
  const currentLabel = MODES.find((mode) => mode.value === current)?.label ?? 'access.custom'
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)

  function apply(mode: PermissionPreset): void {
    if (saving) return
    setSaving(true)
    setPermissionPreset(mode)
      .then(() => {
        app.refreshInfo()
        toast.success(t('access.changed'))
      })
      .catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setSaving(false))
  }

  function choose(mode: PermissionPreset): void {
    if (mode === 'full-access' && current !== 'full-access') {
      setConfirming(true)
      return
    }
    apply(mode)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" disabled={saving || app.busy || !app.info} className="gap-1.5 text-muted-foreground" title={t('access.title')}>
            <ShieldCheck className="size-3.5 shrink-0" />
            <span className="truncate">{t(currentLabel)}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-72">
          {MODES.map((mode) => (
            <DropdownMenuItem key={mode.value} className="items-start gap-2" onClick={() => choose(mode.value)}>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm">{t(mode.label)}</span>
                <span className="text-xs text-muted-foreground">{t(mode.description)}</span>
              </span>
              {mode.value === current ? <Check className="mt-0.5 ml-auto size-3.5 shrink-0" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('access.full.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('access.full.confirmDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('access.full.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirming(false)
                apply('full-access')
              }}
            >
              {t('access.full.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
