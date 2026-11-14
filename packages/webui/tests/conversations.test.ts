import { expect, it } from 'bun:test'
import { Conversations, CONVERSATION_LIMITS } from '../src/lib/conversations'
import type { ChatHandlers } from '../src/api'
import type { SessionSnapshot } from '@ringko-ai/client'

function fixture() {
  const calls: { input: { sessionId?: string; prompt: string; attachments: string[]; loop?: { args: string } }; handlers: ChatHandlers; aborted: boolean }[] = []
  const errors: (string | undefined)[] = []
  const manager = new Conversations((input, handlers) => { const call = { input, handlers, aborted: false }; calls.push(call); return { abort() { call.aborted = true } } }, error => errors.push(error))
  return { manager, calls, errors }
}
it('streams tool previews separately from messages and clears them on completion or cancellation', () => {
  const { manager, calls } = fixture(); manager.send('a', 'read')
  calls[0].handlers.onToolInput?.({ kind: 'start', id: 'call', name: 'read' })
  calls[0].handlers.onToolInput?.({ kind: 'delta', id: 'call', text: '{"path":' })
  expect(manager.get('a').partial?.toolInputs?.[0].text).toBe('{"path":')
  expect(manager.get('a').messages).toHaveLength(1)
  calls[0].handlers.onAssistant({ content: '', reasoning: null, toolCalls: [{ id: 'call', name: 'read', arguments: { path: 'a' } }], turn: 1 })
  expect(manager.get('a').partial).toBeNull()
  manager.stop('a'); calls[0].handlers.onToolInput?.({ kind: 'start', id: 'late', name: 'write' })
  expect(manager.get('a').partial).toBeNull()
});
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
  expect(manager.get('a').queue).toHaveLength(1)
  calls[1].handlers.onSession?.('a')
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
  calls[0].handlers.onSession?.('different-session'); expect(created).toBe('real-session'); expect(manager.peek('different-session')).toBeUndefined()
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

it('keeps streamed text when the user stops or another client cancels', () => {
  const { manager, calls } = fixture()
  manager.send('a', 'write it'); calls[0].handlers.onDelta?.({ kind: 'text', text: 'Partial answer' })
  calls[0].handlers.onToolInput?.({ kind: 'start', id: 'c1', name: 'write' })
  manager.stop('a')
  expect(manager.get('a')).toMatchObject({ busy: false, partial: null, error: null })
  expect(manager.get('a').messages.at(-1)).toMatchObject({ role: 'assistant', content: 'Partial answer', runStatus: 'cancelled' })
  expect(manager.get('a').messages.filter(message => message.role === 'user').map(message => message.runStatus)).toEqual(['cancelled'])

  manager.send('b', 'second'); calls[1].handlers.onDelta?.({ kind: 'text', text: 'Another prefix' })
  calls[1].handlers.onCancelled?.()
  expect(manager.get('b').partial).toBeNull()
  expect(manager.get('b').messages.at(-1)).toMatchObject({ role: 'assistant', content: 'Another prefix', runStatus: 'cancelled' })
  calls[1].handlers.onDone({ sessionId: 'b', content: 'late', turns: 1 }); calls[1].handlers.onError('late failure')
  expect(manager.get('b').messages.at(-1)?.content).toBe('Another prefix')
  expect(manager.get('b').error).toBeNull()
})

it('does not invent an assistant message when cancellation had no text', () => {
  const { manager, calls } = fixture(); manager.send('a', 'silent')
  manager.stop('a'); expect(manager.get('a').messages).toHaveLength(1)
  manager.send('b', 'reasoning'); calls[1].handlers.onDelta?.({ kind: 'reasoning', text: 'thought' })
  calls[1].handlers.onCancelled?.(); expect(manager.get('b').messages).toHaveLength(1)
})

it('pauses the queue after external cancellation instead of auto-sending', async () => {
  const { manager, calls } = fixture(); manager.send('a', 'first'); manager.send('a', 'queued')
  calls[0].handlers.onDelta?.({ kind: 'text', text: 'Partial' }); calls[0].handlers.onCancelled?.()
  await Promise.resolve(); expect(calls).toHaveLength(1); expect(manager.get('a').queue).toHaveLength(1)
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

it('retains rejected new input as a draft and retries creation without a fake session id', () => {
  const { manager, calls } = fixture(); let created: string | undefined
  const pending = manager.sendNew('keep my message', [], undefined, id => { created = id })
  calls[0].handlers.onError('model setup failed')
  expect(manager.get(pending)).toMatchObject({ busy: false, draft: 'keep my message', error: 'model setup failed' })
  manager.send(pending, 'keep my message')
  expect(calls[1].input.sessionId).toBeUndefined(); expect(manager.get(pending).messages).toHaveLength(1)
  calls[0].handlers.onSession?.('stale-session')
  expect(created).toBeUndefined(); expect(manager.peek('stale-session')).toBeUndefined()
  calls[1].handlers.onSession?.('real-session'); expect(created).toBe('real-session'); expect(manager.peek(pending)).toBeUndefined()
  calls[1].handlers.onError('instruction scan failed')
  expect(manager.get('real-session').draft).toBe('keep my message')
})

it('does not replace a newer draft with the failed request text', () => {
  const { manager, calls } = fixture(); manager.send('a', 'old input'); manager.patch('a', { draft: 'my newer draft' })
  calls[0].handlers.onError('failed'); expect(manager.get('a').draft).toBe('my newer draft')
})

it('returns the actual session identity when the transport reports it synchronously', () => {
  const manager = new Conversations((_input, handlers) => { handlers.onSession?.('immediate-session'); return { abort() {} } }, () => {})
  expect(manager.sendNew('hello')).toBe('immediate-session'); expect(manager.get('immediate-session').messages[0].content).toBe('hello')
  manager.dispose()
})

it('bounds pending creations and allows discarded failures to release cache entries', () => {
  const { manager, calls } = fixture(), pending: string[] = []
  for (let index = 0; index < CONVERSATION_LIMITS.cached; index++) pending.push(manager.sendNew('pending'))
  expect(() => manager.sendNew('overflow')).toThrow('cache is full')
  manager.discardPending(pending[0]); expect(manager.peek(pending[0])).toBeDefined()
  calls[0].handlers.onError('rejected'); manager.discardPending(pending[0]); expect(manager.peek(pending[0])).toBeUndefined()
  expect(manager.sendNew('available')).toStartWith('pending:'); manager.dispose()
})

it('directly sends a selected paused item, preserves attachments and loop options, then resumes the remaining FIFO', async () => {
  const { manager, calls } = fixture()
  manager.send('a', 'active'); manager.send('a', 'first'); manager.send('a', 'selected', ['attachment'], { args: 'fixture --max-iterations 1' }); manager.send('a', 'last'); manager.stop('a')
  const item = manager.get('a').queue[1]
  expect(await manager.sendQueuedNow('a', item.id, async () => { throw new Error('Idle sessions must not be stopped') })).toBe(true)
  expect(calls[1].input).toEqual({ sessionId: 'a', prompt: 'selected', attachments: ['attachment'], loop: { args: 'fixture --max-iterations 1' } })
  expect(manager.get('a').queue.map(item => item.prompt)).toEqual(['first', 'selected', 'last'])
  calls[1].handlers.onSession?.('a')
  expect(manager.get('a').queue.map(item => item.prompt)).toEqual(['first', 'last'])
  calls[1].handlers.onDone({ sessionId: 'a', content: 'done', turns: 1 }); await Promise.resolve()
  expect(calls[2].input.prompt).toBe('first')
  calls[2].handlers.onSession?.('a'); calls[2].handlers.onDone({ sessionId: 'a', content: 'done', turns: 1 }); await Promise.resolve()
  expect(calls[3].input.prompt).toBe('last')
})

it('waits for interruption before dispatch, blocks duplicate selection and ignores old callbacks and snapshots', async () => {
  const { manager, calls } = fixture(), ready = Promise.withResolvers<void>()
  manager.send('a', 'active'); manager.send('a', 'first'); manager.send('a', 'selected'); manager.send('b', 'other session')
  const selected = manager.get('a').queue[1], seen: string[] = []
  const sending = manager.sendQueuedNow('a', selected.id, async id => { seen.push(id); await ready.promise })
  expect(manager.get('a')).toMatchObject({ busy: true, sendingQueued: selected.id })
  expect(calls[0].aborted).toBe(true); expect(calls[1].aborted).toBe(false)
  expect(await manager.sendQueuedNow('a', selected.id, async () => { throw new Error('duplicate') })).toBe(false)
  calls[0].handlers.onAssistant({ content: 'stale', reasoning: null, toolCalls: [], turn: 1 }); calls[0].handlers.onError('stale error')
  manager.synchronize({ ...snapshot(), busy: false, error: null })
  manager.send('a', 'new tail'); manager.resume('a'); await Promise.resolve()
  expect(calls).toHaveLength(2); expect(manager.get('a').sendingQueued).toBe(selected.id)
  ready.resolve(); expect(await sending).toBe(true)
  expect(seen).toEqual(['a']); expect(calls[2].input.prompt).toBe('selected')
  calls[2].handlers.onSession?.('a')
  expect(manager.get('a').queue.map(item => item.prompt)).toEqual(['first', 'new tail'])
  expect(manager.get('a').messages.some(message => message.content === 'stale')).toBe(false)
})

it('keeps a selected message and its attachments on stop failure without resuming on a healthy snapshot', async () => {
  const { manager, calls } = fixture()
  manager.send('a', 'active'); manager.send('a', 'selected', ['attachment'])
  const item = manager.get('a').queue[0]
  await expect(manager.sendQueuedNow('a', item.id, async () => { throw new Error('Stop failed') })).rejects.toThrow('Stop failed')
  await Promise.resolve()
  expect(manager.get('a')).toMatchObject({ busy: false, sendingQueued: null, queue: [item], error: 'Stop failed' })
  manager.synchronize({ ...snapshot(), busy: false, error: null }); await Promise.resolve()
  expect(calls).toHaveLength(1)
  expect(await manager.sendQueuedNow('a', item.id, async () => {})).toBe(true)
  expect(calls[1].input.attachments).toEqual(['attachment'])
})

it('cancels an in-flight direct send without dispatching a late replacement', async () => {
  const { manager, calls } = fixture(), ready = Promise.withResolvers<void>(); let signal: AbortSignal | undefined
  manager.send('a', 'active'); manager.send('a', 'selected')
  const item = manager.get('a').queue[0]
  const sending = manager.sendQueuedNow('a', item.id, async (_id, current) => { signal = current; await ready.promise })
  manager.stop('a'); expect(signal?.aborted).toBe(true); ready.resolve()
  expect(await sending).toBe(false); expect(calls).toHaveLength(1)
  expect(manager.get('a')).toMatchObject({ busy: false, sendingQueued: null, queue: [item] })
})

it('retains unaccepted queued requests on transport rejection and does not duplicate them into drafts', async () => {
  const { manager, calls } = fixture()
  manager.send('a', 'active'); manager.send('a', 'selected', ['attachment']); manager.stop('a')
  const item = manager.get('a').queue[0]
  await manager.sendQueuedNow('a', item.id, async () => {})
  calls[1].handlers.onError('Admission rejected')
  expect(manager.get('a')).toMatchObject({ queue: [item], draft: '', busy: false, sendingQueued: null })
  manager.synchronize({ ...snapshot(), busy: false, error: null }); await Promise.resolve()
  expect(calls).toHaveLength(2)
  await manager.sendQueuedNow('a', item.id, async () => {})
  calls[1].handlers.onSession?.('a'); expect(manager.get('a').queue).toHaveLength(1)
  calls[2].handlers.onSession?.('a'); calls[2].handlers.onSession?.('a')
  expect(manager.get('a').queue).toHaveLength(0)
})

it('does not auto-resume after stop wins against a completion microtask', async () => {
  const { manager, calls } = fixture(); manager.send('a', 'active'); manager.send('a', 'queued')
  calls[0].handlers.onDone({ sessionId: 'a', content: 'done', turns: 1 }); manager.stop('a'); await Promise.resolve()
  expect(calls).toHaveLength(1); expect(manager.get('a').queue).toHaveLength(1)
})

it('does not auto-resume when stop wins against a synchronization microtask', async () => {
  const { manager, calls } = fixture()
  manager.patch('a', { queue: [{ id: 'queued', prompt: 'queued', attachments: [] }] })
  manager.synchronize({ ...snapshot(), busy: false, error: null }); manager.stop('a'); await Promise.resolve()
  expect(calls).toHaveLength(0); expect(manager.get('a').queue).toHaveLength(1)
})

it('keeps queued loop arguments consistent with edits and accepts queued creation retries', async () => {
  const { manager, calls } = fixture(), pending = manager.sendNew('initial')
  manager.send(pending, '/loop original', [], { args: 'original' }); const item = manager.get(pending).queue[0]
  manager.editQueued(pending, item.id, '/loop edited --max-iterations 1')
  expect(manager.get(pending).queue[0].loop?.args).toBe('edited --max-iterations 1')
  expect(() => manager.editQueued(pending, item.id, '/loop')).toThrow('require arguments')
  calls[0].handlers.onError('creation failed'); manager.resume(pending)
  expect(calls[1].input.loop?.args).toBe('edited --max-iterations 1')
  expect(calls[1].input.sessionId).toBeUndefined()
  calls[1].handlers.onSession?.('real'); expect(manager.get('real').queue).toEqual([]); expect(manager.get('real').sendingQueued).toBeNull()
  manager.send('real', '/loop another', [], { args: 'another' }); const another = manager.get('real').queue[0]
  manager.editQueued('real', another.id, 'ordinary message'); expect(manager.get('real').queue[0].loop).toBeUndefined()
})

it('rejects pending-session direct sends, missing selections and disposed managers without stopping anything', async () => {
  const { manager, calls } = fixture(); const pending = manager.sendNew('create')
  manager.send(pending, 'queued'); const item = manager.get(pending).queue[0]
  const interrupt = async () => { throw new Error('Should not interrupt') }
  await expect(manager.sendQueuedNow(pending, item.id, interrupt)).rejects.toThrow('session to be created')
  expect(await manager.sendQueuedNow('existing', 'missing', interrupt)).toBe(false)
  manager.dispose(); await expect(manager.sendQueuedNow('existing', 'missing', interrupt)).rejects.toThrow('closed')
  expect(calls).toHaveLength(1)
})

it('does not dispatch an item removed during interruption or after disposal', async () => {
  for (const dispose of [false, true]) {
    const { manager, calls } = fixture(), ready = Promise.withResolvers<void>()
    manager.send('a', 'active'); manager.send('a', 'selected'); const item = manager.get('a').queue[0]
    const sending = manager.sendQueuedNow('a', item.id, async () => { await ready.promise })
    if (dispose) manager.dispose(); else manager.removeQueued('a', item.id)
    ready.resolve(); expect(await sending).toBe(false); expect(calls).toHaveLength(1)
    expect(manager.get('a').sendingQueued).toBeNull()
  }
})

it('keeps the queue bounded while a selected message is waiting for backend admission', async () => {
  const { manager, calls } = fixture(); manager.send('a', 'active')
  for (let index = 0; index < CONVERSATION_LIMITS.queued; index++) manager.send('a', `queued ${index}`)
  manager.stop('a'); const item = manager.get('a').queue.at(-1)!
  await manager.sendQueuedNow('a', item.id, async () => {})
  expect(() => manager.send('a', 'overflow')).toThrow('full')
  calls[1].handlers.onSession?.('a'); manager.send('a', 'available')
  expect(manager.get('a').queue).toHaveLength(CONVERSATION_LIMITS.queued)
})

it('resumes newly queued work after a successful manual retry of a failed run', async () => {
  const { manager, calls } = fixture(); manager.send('a', 'initial'); calls[0].handlers.onError('failed')
  manager.send('a', 'retry'); manager.send('a', 'after retry')
  calls[1].handlers.onDone({ sessionId: 'a', content: 'success', turns: 1 }); await Promise.resolve()
  expect(calls[2].input.prompt).toBe('after retry')
})
