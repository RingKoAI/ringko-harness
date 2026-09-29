import { expect, it } from 'bun:test'
import { matchToolResults, toolCallTarget } from '../src/lib/tool-activity'
import type { ServerMessage } from '../src/api'

it('pairs concurrent results with their own calls and leaves unrelated results visible', () => {
  const messages: ServerMessage[] = [
    { role: 'assistant', content: '', toolCalls: [
      { id: 'one', name: 'read', arguments: { file_path: 'a.ts' } },
      { id: 'two', name: 'shell', arguments: { command: 'echo ready' } },
    ] },
    { role: 'tool', name: 'shell', toolCallId: 'two', content: 'permission denied', failed: true },
    { role: 'tool', name: 'legacy', content: 'orphan' },
    { role: 'tool', name: 'read', toolCallId: 'one', content: 'content', failed: false },
  ]
  const activity = matchToolResults(messages)
  expect(activity.results.get(0)?.get('two')).toEqual(messages[1])
  expect(activity.results.get(0)?.get('one')).toEqual(messages[3])
  expect(activity.attached).toEqual(new Set([1, 3]))
  expect(toolCallTarget(messages[0].toolCalls?.[0].arguments)).toBe('a.ts')
})

it('does not attach an old result to a reused call identifier', () => {
  const activity = matchToolResults([
    { role: 'tool', toolCallId: 'same', content: 'orphan' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'same', name: 'fixture' }] },
    { role: 'tool', toolCallId: 'same', content: 'first' },
    { role: 'tool', toolCallId: 'same', content: 'duplicate' },
  ])
  expect(activity.results.get(1)?.get('same')?.content).toBe('first')
  expect(activity.attached).toEqual(new Set([2]))
})
