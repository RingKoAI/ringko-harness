import { Check, ChevronDown, Circle, ListChecks, ListTodo, LoaderCircle } from 'lucide-react'
import { memo, useId } from 'react'
import type { TodoItem } from '@/api'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Item, ItemContent, ItemGroup } from '@/components/ui/item'
import { useI18n } from '@/i18n'
import { summarizeTodos, todoLabel } from '@/lib/todos'
import { cn } from '@/lib/utils'
import { useApp } from '@/store'

const TodoRow = memo(function TodoRow({ todo }: { todo: TodoItem }) {
  const { t } = useI18n()
  const label = todoLabel(todo)
  return <Item role="listitem" size="sm" data-task-state={todo.status} className="min-w-0 flex-nowrap items-start gap-2 rounded-none border-0 px-0 py-0.5 text-xs motion-reduce:transition-none">
    <span role="img" aria-label={t(`todo.status.${todo.status}`)} className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
      {todo.status === 'completed' ? <Check aria-hidden="true" className="size-3 text-emerald-700 dark:text-emerald-400" />
        : todo.status === 'in_progress' ? <LoaderCircle aria-hidden="true" className="size-3 text-foreground motion-safe:animate-spin" />
        : <Circle aria-hidden="true" className="size-1.5 fill-muted-foreground/50 text-transparent" />}
    </span>
    <ItemContent className="min-w-0">
      <span title={todo.content} className={cn('whitespace-pre-wrap text-xs font-normal leading-5 [overflow-wrap:anywhere]', todo.status === 'completed' ? 'text-muted-foreground line-through decoration-muted-foreground/40' : todo.status === 'in_progress' ? 'text-foreground' : 'text-foreground/80')}>
        {label}
      </span>
    </ItemContent>
  </Item>
}, (previous, next) => previous.todo.content === next.todo.content && previous.todo.status === next.todo.status && previous.todo.activeForm === next.todo.activeForm)

/** Pure presentation keeps live state wiring separate from task rendering. */
export function TodoListCard({ todos, defaultOpen = false }: { todos: readonly TodoItem[]; defaultOpen?: boolean }) {
  const { t } = useI18n()
  const titleId = useId()
  if (todos.length === 0) return null
  const summary = summarizeTodos(todos)
  const done = summary.completed === summary.total
  const Icon = done ? ListChecks : ListTodo
  const current = todos.find(todo => todo.status === 'in_progress') ?? todos.find(todo => todo.status === 'pending')
  const status = done ? t('todo.allCompleted') : summary.inProgress ? t('todo.inProgress', { count: summary.inProgress }) : t('todo.remaining', { count: summary.pending })
  return <Collapsible defaultOpen={defaultOpen} role="region" aria-labelledby={titleId} className="group/todo mb-2 w-full min-w-0 overflow-hidden rounded-xl bg-muted/60">
    <h2 id={titleId} className="sr-only">{t('todo.title')}</h2>
    <CollapsibleTrigger asChild>
      <Button variant="ghost" title={t('todo.progress', summary)} className="h-10 w-full min-w-0 justify-start gap-2 rounded-xl px-3 text-xs font-normal hover:bg-foreground/5 aria-expanded:bg-transparent">
        <Icon aria-hidden="true" className={cn('size-3.5 text-muted-foreground', done && 'text-emerald-700 dark:text-emerald-400')} />
        <span className="shrink-0">{t('todo.compactTitle')}</span>
        <span className="shrink-0 text-muted-foreground tabular-nums">{status}</span>
        {current ? <span className="min-w-0 flex-1 truncate text-left text-muted-foreground/80 group-data-[state=open]/todo:hidden">{todoLabel(current)}</span> : null}
        <ChevronDown aria-hidden="true" className="ml-auto size-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/todo:rotate-180 motion-reduce:transition-none" />
      </Button>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <ItemGroup aria-label={t('todo.title')} className="max-h-36 gap-0 overflow-y-auto overscroll-contain px-3 pb-2 [scrollbar-width:thin] has-data-[size=sm]:gap-0 sm:max-h-44">
        {todos.map((todo, index) => <TodoRow key={`${index}-${todo.content}`} todo={todo} />)}
      </ItemGroup>
    </CollapsibleContent>
    <p className="sr-only">{t('todo.progress', summary)}. {t('todo.readOnly')}</p>
  </Collapsible>
}

export function TodoPanel() {
  const app = useApp()
  return <TodoListCard key={app.sessionId ?? 'draft'} todos={app.todos} />
}
