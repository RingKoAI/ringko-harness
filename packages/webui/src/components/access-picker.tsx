import { Check, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { setAccess, type AccessMode } from '@/api'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useI18n, type MessageKey } from '@/i18n'
import { useApp } from '@/store'

const MODES: { value: AccessMode; label: MessageKey; description: MessageKey }[] = [
  { value: 'approval', label: 'access.approval', description: 'access.approval.desc' },
  { value: 'assist', label: 'access.assist', description: 'access.assist.desc' },
  { value: 'full', label: 'access.full', description: 'access.full.desc' },
]

export function AccessPicker() {
  const { t } = useI18n()
  const app = useApp()
  const current = app.info?.accessMode ?? 'approval'
  const currentLabel = MODES.find((mode) => mode.value === current)?.label ?? 'access.approval'

  function choose(mode: AccessMode): void {
    if (mode === current) return
    setAccess(mode)
      .then(() => {
        app.refreshInfo()
        toast.success(t('access.changed'))
      })
      .catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : String(cause)))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" title={t('access.title')}>
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
  )
}
