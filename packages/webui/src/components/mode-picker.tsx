import { Check, Compass } from 'lucide-react'
import { toast } from 'sonner'
import { setMode } from '@/api'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { useApp } from '@/store'

export function ModePicker() {
  const { t } = useI18n()
  const app = useApp()
  const current = app.info?.mode?.id ?? 'agent'
  const workflows = app.info?.workflows ?? []
  const currentLabel = app.info?.mode?.label ?? current

  function choose(id: string): void {
    if (id === current) return
    setMode(id)
      .then(() => {
        app.refreshInfo()
        toast.success(t('mode.changed'))
      })
      .catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : String(cause)))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" title={t('mode.title')}>
          <Compass className="size-3.5 shrink-0" />
          <span className="truncate">{currentLabel}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-72">
        {workflows.map((workflow) => (
          <DropdownMenuItem key={workflow.id} className="items-start gap-2" onClick={() => choose(workflow.id)}>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm">{workflow.label}</span>
              {workflow.description ? (
                <span className="text-xs text-muted-foreground">{workflow.description}</span>
              ) : null}
            </span>
            {workflow.id === current ? <Check className="mt-0.5 ml-auto size-3.5 shrink-0" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
