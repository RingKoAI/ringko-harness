import type { ServerMessage } from '@/api'

/** Link results to the most recent unresolved call, preserving message indices for branching. */
export function matchToolResults(messages: readonly ServerMessage[]) {
  const pending = new Map<string, number>()
  const results = new Map<number, Map<string, ServerMessage>>()
  const attached = new Set<number>()
  messages.forEach((message, index) => {
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) pending.set(call.id, index)
    }
    if (message.role !== 'tool' || !message.toolCallId) return
    const owner = pending.get(message.toolCallId)
    if (owner === undefined) return
    pending.delete(message.toolCallId)
    let group = results.get(owner)
    if (!group) { group = new Map(); results.set(owner, group) }
    group.set(message.toolCallId, message)
    attached.add(index)
  })
  return { results, attached }
}

export function toolCallTarget(input: unknown): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const args = input as Record<string, unknown>
  for (const key of ['file_path', 'path', 'pattern', 'command', 'url', 'description']) {
    if (typeof args[key] === 'string' && args[key]) return args[key].replace(/\s+/g, ' ').slice(0, 120)
  }
  return undefined
}

export type ToolActivityKind = 'read' | 'search' | 'write' | 'commands' | 'subtasks' | 'plan' | 'tools'

/** Coarse tool category used by the collapsed activity summary. */
export function toolActivityKind(name: string): ToolActivityKind {
  if (name === 'read' || name === 'tree') return 'read'
  if (name === 'glob' || name === 'grep') return 'search'
  if (name === 'write' || name === 'edit') return 'write'
  if (name === 'shell' || name === 'terminal') return 'commands'
  if (name === 'task' || name === 'job' || name === 'subscribe') return 'subtasks'
  if (name === 'plan' || name === 'update_plan') return 'plan'
  return 'tools'
}
