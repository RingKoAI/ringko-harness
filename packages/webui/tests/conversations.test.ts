import { expect, it } from 'bun:test'
import { Conversations, CONVERSATION_LIMITS } from '../src/lib/conversations'
import type { ChatHandlers } from '../src/api'
import type { SessionSnapshot } from '@ringko-ai/client'

function fixture() {
  const calls: { input: { sessionId?: string; prompt: string }; handlers: ChatHandlers; aborted: boolean }[] = []
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
  calls[0].handlers.onTool({ name: 'write', toolCallId: 'call-a', content: 'denied', error: true, turn: 1 })
  expect(manager.get('a').messages.at(-1)).toMatchObject({ role: 'tool', toolCallId: 'call-a', failed: true, content: 'denied' })
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
it('seeds a new conversation and migrates to the backend-created session', () => {
  const { manager, calls, errors } = fixture()
  let created: string | undefined
  const pending = manager.sendNew('hello', [], undefined, id => { created = id })
  expect(calls[0].input.sessionId).toBeUndefined()
  expect(manager.get(pending).messages[0]).toMatchObject({ role: 'user', content: 'hello' })
  calls[0].handlers.onSession?.('real-session')
  expect(created).toBe('real-session')
  expect(manager.peek(pending)).toBeUndefined()
  expect(manager.get('real-session').messages[0]).toMatchObject({ role: 'user', content: 'hello' })
  calls[0].handlers.onAssistant({ content: 'answer', reasoning: null, toolCalls: [], turn: 1 })
  calls[0].handlers.onDone({ sessionId: 'real-session', content: 'answer', turns: 1 })
  expect(manager.get('real-session').messages.at(-1)?.content).toBe('answer')
  expect(errors).toEqual([undefined])
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

function snapshot(id = 'a'): SessionSnapshot {
  return { id, instance: 'fixture', revision: 1, title: null, summary: null, archived: false, messages: [{ role: 'user', content: 'from another terminal' }], events: [], busy: true,
    approvals: [{ id: 'approval', toolName: 'shell', riskLevel: 'high', riskKind: 'shell', reason: 'fixture', target: 'echo fixture' }], questions: [], tasks: [], todos: [], jobs: [], partial: { content: 'shared partial', reasoning: '' }, loop: null, error: null }
}
it('loads another terminal\'s run without losing local drafts and settles from a snapshot', () => {
  const { manager } = fixture(); manager.patch('a', { draft: 'keep my draft' })
  manager.synchronize(snapshot())
  expect(manager.get('a')).toMatchObject({ busy: true, draft: 'keep my draft', partial: { content: 'shared partial' }, approval: { id: 'approval' } })
  manager.synchronize({ ...snapshot(), revision: 2, busy: false, partial: null, approvals: [], messages: [{ role: 'assistant', content: 'shared done' }] })
  expect(manager.get('a')).toMatchObject({ busy: false, draft: 'keep my draft', approval: null, messages: [{ role: 'assistant', content: 'shared done' }] })
})
it('does not double-append snapshots while its own HTTP stream is active', () => {
  const { manager, calls } = fixture(); manager.send('a', 'local prompt')
  manager.synchronize(snapshot())
  calls[0].handlers.onAssistant({ content: 'local answer', reasoning: null, toolCalls: [], turn: 1 })
  expect(manager.get('a').messages.map(message => message.content)).toEqual(['local prompt', 'local answer'])
})
it('does not resume a manually paused queue or overwrite a newer snapshot', async () => {
  const { manager, calls } = fixture(); manager.send('a', 'first'); manager.send('a', 'queued'); manager.stop('a')
  manager.synchronize({ ...snapshot(), revision: 10, busy: false, approvals: [], partial: null, messages: [{ role: 'assistant', content: 'newer' }] })
  manager.synchronize({ ...snapshot(), revision: 9 })
  await Promise.resolve()
  expect(calls).toHaveLength(1); expect(manager.get('a').busy).toBe(false)
  expect(manager.get('a').messages.at(-1)?.content).toBe('newer')
  manager.resume('a'); expect(calls).toHaveLength(2)
})

it('preserves a turn view identity through stream completion, hydration and compaction', () => {
  const { manager, calls } = fixture(); manager.send('a', 'same prompt')
  const identity = manager.get('a').messages[0].viewId
  manager.setToolExpansion('a', identity!, false, true)
  calls[0].handlers.onDone({ sessionId: 'a', content: 'done', turns: 1 })
  const value: SessionSnapshot = { ...snapshot(), busy: false, partial: null, approvals: [], messages: [{ role: 'user', content: 'same prompt', sourceSeq: 2 }, { role: 'assistant', content: 'done', sourceSeq: 3 }], events: [
    { seq: 1, time: 1, type: 'run/started', data: { runId: 'run' } }, { seq: 2, time: 2, type: 'user/message' }, { seq: 3, time: 3, type: 'assistant/message' }, { seq: 4, time: 4, type: 'run/completed', data: { runId: 'run' } },
  ] }
  manager.synchronize(value)
  expect(manager.get('a').messages[0]).toMatchObject({ viewId: identity, runStatus: 'completed' })
  manager.synchronize({ ...value, revision: 2, messages: [{ role: 'system', content: 'summary', sourceSeq: 5 }, ...value.messages] })
  expect(manager.get('a').messages[1].viewId).toBe(identity)
  expect(manager.get('a').toolExpansions[identity!]).toEqual({ details: false, open: true })
  manager.synchronize({ ...value, revision: 3, messages: [{ role: 'system', content: 'summary', sourceSeq: 5 }, value.messages[1]] })
  expect(manager.get('a').toolExpansions['run:1']).toEqual({ details: false, open: true })
})

it('marks only the owned input cancelled and ignores a late terminal callback', () => {
  const { manager, calls } = fixture(); manager.send('a', 'first')
  calls[0].handlers.onDone({ sessionId: 'a', content: 'done', turns: 1 })
  manager.send('a', 'second'); manager.stop('a')
  calls[1].handlers.onDone({ sessionId: 'a', content: 'late', turns: 1 })
  expect(manager.get('a').messages.filter(message => message.role === 'user').map(message => message.runStatus)).toEqual(['completed', 'cancelled'])
})
