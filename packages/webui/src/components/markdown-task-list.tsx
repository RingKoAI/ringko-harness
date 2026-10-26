import { Children, isValidElement, type ComponentProps, type ReactNode } from 'react'
import type { ExtraProps } from 'react-markdown'
import { TaskMarker } from '@/components/task-marker'
import { cn } from '@/lib/utils'

type MarkdownProps<Tag extends 'li' | 'input'> = ComponentProps<Tag> & ExtraProps

function isNestedList(child: ReactNode): boolean {
  if (!isValidElement<{ node?: { tagName?: string } }>(child)) return false
  const tag = typeof child.type === 'string' ? child.type : child.props.node?.tagName
  return tag === 'ul' || tag === 'ol'
}

/** Only inspect this task's checkbox, never the checkboxes of nested tasks. */
function isCompleted(node: ExtraProps['node']): boolean {
  if (!node) return false
  for (const child of node.children) {
    if (child.type !== 'element') continue
    const candidates = child.tagName === 'p' ? child.children : [child]
    for (const candidate of candidates) {
      if (candidate.type === 'element' && candidate.tagName === 'input' && candidate.properties.type === 'checkbox') return candidate.properties.checked === true
    }
  }
  return false
}

/** Keep nested lists in place and out of the parent's completed-text decoration. */
function taskChildren(children: ReactNode, completed: boolean): ReactNode[] {
  const output: ReactNode[] = []
  let copy: ReactNode[] = []
  const flush = () => {
    if (copy.some(child => typeof child !== 'string' || child.trim())) {
      output.push(<div key={`copy-${output.length}`} className="markdown-task-copy" data-completed={completed}>{copy}</div>)
    }
    copy = []
  }
  for (const child of Children.toArray(children)) {
    if (isNestedList(child)) { flush(); output.push(child) }
    else copy.push(child)
  }
  flush()
  return output
}

export function MarkdownListItem({ node, className, children, ...props }: MarkdownProps<'li'>) {
  if (!className?.split(/\s+/).includes('task-list-item')) return <li {...props} className={className}>{children}</li>
  const completed = isCompleted(node)
  return <li {...props} className={cn(className, 'markdown-task-item')} data-task-state={completed ? 'completed' : 'pending'}>
    {taskChildren(children, completed)}
  </li>
}

export function MarkdownTaskInput({ type, checked }: MarkdownProps<'input'>) {
  if (type !== 'checkbox') return null
  return <TaskMarker status={checked ? 'completed' : 'pending'} className="markdown-task-marker" />
}
