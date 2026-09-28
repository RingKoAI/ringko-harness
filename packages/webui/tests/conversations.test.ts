import { expect, it } from 'bun:test'
import { Conversations, CONVERSATION_LIMITS } from '../src/lib/conversations'
import type { ChatHandlers } from '../src/api'

function fixture() {
  const calls: { input: { sessionId: string; prompt: string }; handlers: ChatHandlers; aborted: boolean }[] = []
  const errors: (string | undefined)[] = []
  const manager = new Conversations((input, handlers) => { const call = { input, handlers, aborted: false }; calls.push(call); return { abort() { call.aborted = true } } }, error => errors.push(error))
  return { manager, calls, errors }
}
it('isolates simultaneous session streams, approvals, reasoning and tool events', () => {
  const { manager, calls } = fixture()
  manager.send('a', 'A'); manager.send('b', 'B')
  calls[0].handlers.onDelta?.({ kind: 'text', text: 'a part' })
  calls[1].handlers.onDelta?.({ kind: 'reasoning', text: 'b thought' })
  calls[0].handlers.onApproval({ id: 'approval-a', toolName: 'write', riskLevel: 'write', reason: 'change', target: 'a' })
  expect(manager.get('a').partial?.content).toBe('a part')
  expect(manager.get('b').partial?.reasoning).toBe('b thought')
  expect(manager.get('b').approval).toBeNull()
  calls[0].handlers.onAssistant({ content: 'A result', reasoning: null, toolCalls: [], turn: 1 })
  expect(manager.get('a').partial).toBeNull()
  expect(manager.get('a').messages.at(-1)?.content).toBe('A result')
  expect(manager.get('b').messages).toHaveLength(1)
})
it('queues editable messages in order and continues exactly once after completion', async () => {
  const { manager, calls } = fixture()
  manager.send('a', 'first'); manager.send('a', 'second', ['file']); manager.send('a', 'remove me')
  const queued = manager.get('a').queue
  manager.editQueued('a', queued[0].id, 'edited second'); manager.removeQueued('a', queued[1].id)
  calls[0].handlers.onDone({ sessionId: 'a', content: 'first result', turns: 1 })
  calls[0].handlers.onDone({ sessionId: 'a', content: 'duplicate', turns: 1 })
  await Promise.resolve()
  expect(calls).toHaveLength(2); expect(calls[1].input.prompt).toBe('edited second')
  expect(manager.get('a').queue).toHaveLength(0)
})
it('stops only the selected run, ignores late callbacks and pauses its queue', async () => {
  const { manager, calls } = fixture()
  manager.send('a', 'A'); manager.send('a', 'queued'); manager.send('b', 'B')
  manager.stop('a')
  calls[0].handlers.onAssistant({ content: 'late', reasoning: null, toolCalls: [], turn: 1 })
  calls[0].handlers.onDone({ sessionId: 'a', content: 'late', turns: 1 })
  await Promise.resolve()
  expect(manager.get('a').messages).toHaveLength(1); expect(manager.get('a').queue).toHaveLength(1)
  expect(calls[0].aborted).toBe(true); expect(calls[1].aborted).toBe(false)
  manager.resume('a'); expect(calls).toHaveLength(3)
})
it('rejects stale history loads, oversized input and excessive queued work', () => {
  const { manager } = fixture(); const old = manager.get('a')
  manager.patch('a', { draft: 'keep this' }); manager.load('a', { messages: [{ role: 'user', content: 'old' }] }, old)
  expect(manager.get('a').messages).toEqual([])
  manager.send('a', 'run')
  for (let index = 0; index < CONVERSATION_LIMITS.queued; index++) manager.send('a', `queued ${index}`)
  expect(() => manager.send('a', 'excess')).toThrow('full')
  expect(() => manager.send('b', 'x'.repeat(CONVERSATION_LIMITS.prompt + 1))).toThrow('size')
})
