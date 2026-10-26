import type { TodoItem } from '@/api'

export function summarizeTodos(todos: readonly TodoItem[]) {
  const completed = todos.filter(todo => todo.status === 'completed').length
  const inProgress = todos.filter(todo => todo.status === 'in_progress').length
  return {
    total: todos.length,
    completed,
    inProgress,
    pending: todos.length - completed - inProgress,
    percent: todos.length ? Math.round(completed / todos.length * 100) : 0,
  }
}

export function todoLabel(todo: TodoItem): string {
  return todo.status === 'in_progress' && todo.activeForm?.trim() ? todo.activeForm : todo.content
}
