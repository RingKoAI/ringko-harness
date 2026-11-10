import { expect, it } from 'bun:test'
import { toolTurns } from '../src/lib/tool-activity'

it('keeps ambiguous duplicate call IDs and their unmatched result visible', () => {
  const activity = toolTurns([{ role: 'user', content: 'work' }, { role: 'assistant', content: '', toolCalls: [{ id: 'duplicate', name: 'read' }, { id: 'duplicate', name: 'write' }] }, { role: 'tool', toolCallId: 'duplicate', content: 'raw result', failed: true }, { role: 'assistant', content: 'answer' }], false)
  expect(activity.attached.size).toBe(0)
  expect(activity.turns[0]).toMatchObject({ foldable: false, count: 3, orphans: 1, unknown: 3, failed: 1 })
})
