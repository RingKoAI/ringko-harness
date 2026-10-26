import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '../src/i18n'
import { TodoListCard } from '../src/components/todo-panel'
import { Markdown } from '../src/components/markdown'
import { summarizeTodos, todoLabel } from '../src/lib/todos'
import type { TodoItem } from '../src/api'

const items: TodoItem[] = [
  { content: 'Inspect files', status: 'completed', activeForm: 'Inspecting files' },
  { content: 'Run checks', status: 'in_progress', activeForm: 'Running checks' },
  { content: 'Publish changes', status: 'pending' },
]

describe('task presentation', () => {
  it('derives completion from completed tasks and only uses activeForm while running', () => {
    expect(summarizeTodos(items)).toEqual({ total: 3, completed: 1, inProgress: 1, pending: 1, percent: 33 })
    expect(summarizeTodos([]).percent).toBe(0)
    expect(todoLabel(items[0])).toBe('Inspect files')
    expect(todoLabel(items[1])).toBe('Running checks')
    expect(todoLabel({ ...items[1], activeForm: ' ' })).toBe('Run checks')
  })

  it('defaults to a collapsed summary with the current task instead of a large list', () => {
    const html = renderToStaticMarkup(<I18nProvider><TodoListCard todos={items} /></I18nProvider>)
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('Running checks')
    expect(html).not.toContain('role="listitem"')
    expect(html).not.toContain('role="progressbar"')
  })

  it('expands into compact read-only rows with the original active-task text available', () => {
    const html = renderToStaticMarkup(<I18nProvider><TodoListCard todos={items} defaultOpen /></I18nProvider>)
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('data-task-state="in_progress"')
    expect(html.match(/role="listitem"/g)).toHaveLength(3)
    expect(html).toContain('Running checks')
    expect(html).toContain('title="Run checks"')
    expect(html).not.toContain('role="checkbox"')
    expect(html).not.toContain('Inspecting files')
  })

  it('hides empty lists and displays completed progress without an active spinner', () => {
    expect(renderToStaticMarkup(<I18nProvider><TodoListCard todos={[]} /></I18nProvider>)).toBe('')
    const html = renderToStaticMarkup(<I18nProvider><TodoListCard todos={[items[0]]} defaultOpen /></I18nProvider>)
    expect(html).toContain('data-task-state="completed"')
    expect(html).not.toContain('animate-spin')
  })
})

describe('Markdown tasks', () => {
  const render = (content: string) => renderToStaticMarkup(<I18nProvider><Markdown content={content} /></I18nProvider>)

  it('customizes GFM tasks but preserves ordinary lists and Markdown inline formatting', () => {
    const html = render('- [ ] **Review** `src/main.ts`\n- [x] Done\n\n- ordinary item')
    expect(html.match(/data-slot="checkbox"/g)).toHaveLength(2)
    expect(html).toContain('data-task-state="pending"')
    expect(html).toContain('data-task-state="completed"')
    expect(html).toContain('<strong>Review</strong>')
    expect(html).toContain('src/main.ts')
    expect(html).toMatch(/<li>\s*(?:<p>)?ordinary item(?:<\/p>)?\s*<\/li>/)
    expect(html).not.toContain('node="[object Object]"')
  })

  it('keeps nested pending children independent from completed parent copy', () => {
    const html = render('- [x] Completed parent\n  - [ ] Pending child\n  - [x] Completed child')
    expect(html.match(/data-task-state="completed"/g)).toHaveLength(2)
    expect(html.match(/data-task-state="pending"/g)).toHaveLength(1)
    expect(html).toContain('data-completed="false"')
    expect(html).toContain('Pending child')
  })

  it('preserves loose-list paragraph and nested-list order without enabling raw HTML', () => {
    const html = render('- [x] Before\n\n  - [ ] Nested\n\n  After paragraph\n\n<script>alert("x")</script>')
    expect(html.indexOf('Before')).toBeLessThan(html.indexOf('Nested'))
    expect(html.indexOf('Nested')).toBeLessThan(html.indexOf('After paragraph'))
    expect(html).not.toContain('<script>')
  })
})
