import { Brain, Check } from 'lucide-react'
import { toast } from 'sonner'
import { setThinking } from '@/api'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useI18n, type MessageKey } from '@/i18n'
import { useApp } from '@/store'

const LEVELS: { value: string; label: MessageKey }[] = [
  { value: 'off', label: 'thinking.off' },
  { value: 'low', label: 'thinking.low' },
  { value: 'high', label: 'thinking.high' },
  { value: 'max', label: 'thinking.max' },
]

export function ThinkingPicker() {
  const { t } = useI18n()
  const app = useApp()
  const current = app.info?.thinking ?? 'high'
  const currentLabel = LEVELS.find((level) => level.value === current)?.label ?? 'thinking.high'

  function choose(level: string): void {
    if (level === current) return
    setThinking(level)
      .then(() => {
        app.refreshInfo()
        toast.success(t('thinking.changed'))
      })
      .catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : String(cause)))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" title={t('thinking.title')}>
          <Brain className="size-3.5 shrink-0" />
          <span className="truncate">{t(currentLabel)}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top">
        {LEVELS.map((level) => (
          <DropdownMenuItem key={level.value} onClick={() => choose(level.value)}>
            {t(level.label)}
            {level.value === current ? <Check className="ml-auto size-3.5" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
