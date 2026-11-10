import type { ServerMessage } from '@/api'
import { transcriptTurns, toolActivityKind, type ToolActivityKind, type TranscriptTurn } from '@ringko-ai/client'
import { editDiff } from './edit-diff'
export { toolActivityKind }
export type { ToolActivityKind }

/** Link results to the most recent unresolved call, preserving message indices for branching. */
export function matchToolResults(messages: readonly ServerMessage[]) {
  const pending = new Map<string, number>()
  const results = new Map<number, Map<string, ServerMessage>>()
  const attached = new Set<number>()
  let runStart: number | undefined
  messages.forEach((message, index) => {
    if (message.role === 'user' || (message.runStart !== undefined && runStart !== undefined && message.runStart !== runStart)) pending.clear()
    if (message.runStart !== undefined) runStart = message.runStart
    if (message.role === 'assistant') {
      const ids = new Map<string, number>()
      for (const call of message.toolCalls ?? []) ids.set(call.id, (ids.get(call.id) ?? 0) + 1)
      for (const call of message.toolCalls ?? []) { if (ids.get(call.id) === 1) pending.set(call.id, index); else pending.delete(call.id) }
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

export interface ToolTurn extends TranscriptTurn {
  key: string;
  count: number;
  failed: number;
  unknown: number;
  orphans: number;
  running: boolean;
  foldable: boolean;
  additions: number;
  deletions: number;
  counts: ReadonlyMap<ToolActivityKind, number>;
}

/** One user turn includes every tool-bearing assistant step, not just adjacent reads. */
export function toolTurns(messages: readonly ServerMessage[], busy: boolean, error: string | null = null) {
  const activity = matchToolResults(messages)
  const ranges = transcriptTurns(messages)
  const turns: ToolTurn[] = ranges.map((turn, ordinal) => {
    const counts = new Map<ToolActivityKind, number>()
    let count = 0, failed = 0, unknown = 0, orphans = 0, lastTool = -1, answer = -1, additions = 0, deletions = 0
    const running = turn.status === 'running' || (turn.status === undefined && busy && ordinal === ranges.length - 1)
    for (let index = turn.start; index < turn.end; index++) {
      const message = messages[index]!
      if (message.role === 'assistant') {
        if (message.content.trim() && !message.toolCalls?.length) answer = index
        for (const call of message.toolCalls ?? []) {
          count++; lastTool = Math.max(lastTool, index)
          counts.set(toolActivityKind(call.name), (counts.get(toolActivityKind(call.name)) ?? 0) + 1)
          if (call.name === 'edit') { const diff = editDiff(call.arguments); if (diff) { additions += diff.additions; deletions += diff.deletions } }
          const result = activity.results.get(index)?.get(call.id)
          if (!result) unknown++
          if (result?.failed) failed++
        }
      } else if (message.role === 'tool') {
        lastTool = index
        if (!activity.attached.has(index)) { count++; unknown++; orphans++; if (message.failed) failed++ }
      }
    }
    const completed = turn.status === 'completed' || (turn.status === undefined && answer > lastTool)
    const user = turn.userIndex === undefined ? undefined : messages[turn.userIndex]
    const latestError = ordinal === ranges.length - 1 && error !== null && turn.status !== 'completed'
    return { ...turn, key: user?.viewId ?? (turn.runStart !== undefined ? `run:${turn.runStart}` : `turn:${turn.start}`), count, failed, unknown, orphans, running, additions, deletions,
      foldable: count > 0 && !running && completed && !failed && !unknown && !latestError && (turn.userIndex !== undefined || turn.runStart !== undefined), counts }
  })
  return { ...activity, turns }
}

export function toolCallTarget(input: unknown): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const args = input as Record<string, unknown>
  for (const key of ['file_path', 'path', 'pattern', 'command', 'url', 'description']) {
    if (typeof args[key] === 'string' && args[key]) return args[key].replace(/\s+/g, ' ').slice(0, 120)
  }
  return undefined
}
