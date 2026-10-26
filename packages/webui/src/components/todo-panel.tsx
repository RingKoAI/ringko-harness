import { ListChecks, ListTodo } from 'lucide-react'
import { memo, useId } from 'react'
import type { TodoItem } from '@/api'
import { TaskMarker } from '@/components/task-marker'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Progress } from '@/components/ui/progress'
import { useI18n } from '@/i18n'
import { summarizeTodos, todoLabel } from '@/lib/todos'
import { cn } from '@/lib/utils'
import { useApp } from '@/store'

const ROW_TONES = {
  pending: 'border-border/60 bg-background/40',
  in_progress: 'border-primary/25 bg-primary/5',
  completed: 'border-emerald-600/15 bg-emerald-600/5 dark:border-emerald-400/15 dark:bg-emerald-400/5',
} as const

const TodoRow = memo(function TodoRow({ todo }: { todo: TodoItem }) {
  const { t } = useI18n()
  const label = todoLabel(todo)
  return <Item role="listitem" size="sm" variant="outline" data-task-state={todo.status} className={cn('min-w-0 flex-nowrap items-start gap-3 px-3 py-2.5 motion-reduce:transition-none', ROW_TONES[todo.status])}>
    <ItemMedia className="mt-0.5 self-start">
      <TaskMarker status={todo.status} />
    </ItemMedia>
    <ItemContent className="min-w-0 gap-1">
      <ItemTitle className={cn('block w-full min-w-0 line-clamp-none whitespace-pre-wrap text-sm leading-5 [overflow-wrap:anywhere]', todo.status === 'completed' && 'font-normal text-muted-foreground line-through decoration-muted-foreground/50')}>
        {label}
      </ItemTitle>
      {label !== todo.content ? <ItemDescription className="line-clamp-none whitespace-pre-wrap text-xs [overflow-wrap:anywhere]">{todo.content}</ItemDescription> : null}
    </ItemContent>
    <Badge variant="outline" className={cn('mt-0.5 shrink-0 border-transparent px-1.5 text-[10px] font-normal', todo.status === 'completed' ? 'bg-emerald-600/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-400' : todo.status === 'in_progress' ? 'bg-primary/10 text-foreground' : 'bg-muted/70 text-muted-foreground')}>
      {t(`todo.status.${todo.status}`)}
    </Badge>
  </Item>
}, (previous, next) => previous.todo.content === next.todo.content && previous.todo.status === next.todo.status && previous.todo.activeForm === next.todo.activeForm)

/** Pure presentation keeps live state wiring separate from task rendering. */
export function TodoListCard({ todos }: { todos: readonly TodoItem[] }) {
  const { t } = useI18n()
  const titleId = useId()
  if (todos.length === 0) return null
  const summary = summarizeTodos(todos)
  const done = summary.completed === summary.total
  const Icon = done ? ListChecks : ListTodo
  return <Card role="region" aria-labelledby={titleId} size="sm" className="mx-auto mb-3 w-full min-w-0 max-w-3xl gap-3 rounded-xl bg-card/95 shadow-sm">
    <CardHeader className="gap-2.5 px-3.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40', done && 'border-emerald-600/20 bg-emerald-600/5 text-emerald-700 dark:text-emerald-400')}>
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <CardTitle><h2 id={titleId}>{t('todo.title')}</h2></CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">{done ? t('todo.allCompleted') : t('todo.progress', summary)}</p>
        </div>
        <span className={cn('shrink-0 text-sm font-semibold tabular-nums', done && 'text-emerald-700 dark:text-emerald-400')} aria-hidden="true">{summary.percent}%</span>
      </div>
      <Progress
        value={summary.percent}
        aria-label={t('todo.progress', summary)}
        aria-valuenow={summary.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={t('todo.progress', summary)}
        className={cn('h-1.5 [&_[data-slot=progress-indicator]]:motion-reduce:transition-none', done && '[&_[data-slot=progress-indicator]]:bg-emerald-600 dark:[&_[data-slot=progress-indicator]]:bg-emerald-400')}
      />
    </CardHeader>
    <CardContent className="px-3.5">
      <ItemGroup aria-label={t('todo.title')} className="max-h-64 gap-1.5 overflow-y-auto overscroll-contain p-px">
        {todos.map((todo, index) => <TodoRow key={`${index}-${todo.content}`} todo={todo} />)}
      </ItemGroup>
    </CardContent>
    <CardFooter className="flex-wrap justify-between gap-x-3 gap-y-1 px-3.5 py-2 text-[11px] text-muted-foreground">
      <span>{t('todo.readOnly')}</span>
      {!done ? <span className="tabular-nums">{summary.inProgress ? t('todo.inProgress', { count: summary.inProgress }) : t('todo.remaining', { count: summary.pending })}</span> : null}
    </CardFooter>
  </Card>
}

export function TodoPanel() {
  const app = useApp()
  return <TodoListCard todos={app.todos} />
}
