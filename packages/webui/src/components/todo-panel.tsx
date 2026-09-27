import { Check, Circle, LoaderCircle } from 'lucide-react'
import type { TodoItem } from '@/api'
import { useI18n } from '@/i18n'
import { useApp } from '@/store'

function StatusIcon({ status }: { status: TodoItem['status'] }) {
  if (status === 'completed') return <Check className="size-3.5 text-emerald-500" />
  if (status === 'in_progress') return <LoaderCircle className="size-3.5 animate-spin text-primary" />
  return <Circle className="size-3.5 text-muted-foreground" />
}

export function TodoPanel() {
  const { t } = useI18n()
  const app = useApp()
  if (app.todos.length === 0) return null

  return (
    <div className="mx-auto mb-2 max-w-3xl rounded-lg border bg-muted/20 px-3 py-2">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{t('todo.title')}</p>
      <ul className="space-y-0.5">
        {app.todos.map((todo, index) => (
          <li key={index} className="flex items-center gap-2 text-xs">
            <StatusIcon status={todo.status} />
            <span className={todo.status === 'completed' ? 'text-muted-foreground line-through' : ''}>{todo.content}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
