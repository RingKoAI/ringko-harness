import type { Approval, ChatHandlers, JobSummary, LoopStatus, QuestionRequest, ServerMessage, TaskSummary, TodoItem } from '../api'
import { applyToolInputDelta, restoreTranscript, type PartialResponse, type SessionSnapshot, type SessionUsage } from '@ringko-ai/client'
import { normalizeSessionUsage } from './session-usage'

export const CONVERSATION_LIMITS = { queued: 16, prompt: 65536, partial: 262144, cached: 64 } as const
const PENDING_SESSION_PREFIX = 'pending:'
export const isPendingSessionId = (id: string | undefined): boolean => id?.startsWith(PENDING_SESSION_PREFIX) === true
export interface QueuedMessage { id: string; prompt: string; attachments: string[]; loop?: { args: string } }
export interface Conversation {
  messages: ServerMessage[]; busy: boolean; approval: Approval | null; question: QuestionRequest | null
  tasks: TaskSummary[]; jobs: JobSummary[]; todos: TodoItem[]; queue: QueuedMessage[]; sendingQueued: string | null
  partial: PartialResponse | null; draft: string; error: string | null; loop: LoopStatus | null
  usage: SessionUsage | null; model: string | null
  toolExpansions: Record<string, { details: boolean; open: boolean }>
}
export const emptyConversation = (): Conversation => ({ messages: [], busy: false, approval: null, question: null, tasks: [], jobs: [], todos: [], queue: [], sendingQueued: null, partial: null, draft: '', error: null, loop: null, usage: null, model: null, toolExpansions: {} })
type Transport = (input: { sessionId?: string; prompt: string; attachments: string[]; loop?: { args: string } }, handlers: ChatHandlers) => { abort(): void }
function stoppedState(state: Conversation, userId?: string): Partial<Conversation> {
  const owner = userId ? state.messages.find(message => message.role === 'user' && message.viewId === userId) : state.messages.findLast(message => message.role === 'user' && message.runStatus === 'running')
  // Keep the prefix the user already saw; tool previews are never outcomes.
  const streamed = state.partial?.content.trim()
    ? [{ role: 'assistant' as const, content: state.partial.content, ...(state.partial.reasoning ? { reasoning: state.partial.reasoning } : {}), runStatus: 'cancelled' as const }]
    : []
  return { busy: false, sendingQueued: null, partial: null, approval: null, question: null, loop: null,
    messages: [...state.messages.map(message => message === owner ? { ...message, runStatus: 'cancelled' as const } : message), ...streamed],
    tasks: state.tasks.map(task => task.status === 'running' ? { ...task, status: 'unknown' } : task),
    jobs: state.jobs.map(job => job.status === 'running' ? { ...job, status: 'unknown' } : job) }
}

/** Owns each stream independently of the currently visible route. Late callbacks are discarded. */
export class Conversations {
  private states = new Map<string, Conversation>()
  private runs = new Map<string, { token: symbol; userId: string; abort(): void }>()
  private listeners = new Set<() => void>()
  private paused = new Set<string>()
  private revisions = new Map<string, { instance: string; revision: number }>()
  private creations = new Map<string, { onCreated?: (id: string) => void }>()
  private disposed = false
  private transport: Transport
  private report: (error?: string, sessionId?: string) => void
  constructor(transport: Transport, report: (error?: string, sessionId?: string) => void) { this.transport = transport; this.report = report }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  peek(id: string): Conversation | undefined { return this.states.get(id) }
  get(id: string): Conversation {
    let state = this.states.get(id)
    if (!state) {
      if (this.states.size >= CONVERSATION_LIMITS.cached) {
        const disposable = [...this.states].find(([, item]) => !item.busy && !item.queue.length && !item.draft)
        if (!disposable) throw new Error('Conversation cache is full. Finish or clear a queued conversation.')
        this.states.delete(disposable[0])
        this.creations.delete(disposable[0])
        this.paused.delete(disposable[0]); this.revisions.delete(disposable[0])
      }
      state = emptyConversation(); this.states.set(id, state)
    }
    return state
  }
  patch(id: string, patch: Partial<Conversation>) { this.states.set(id, { ...this.get(id), ...patch }); for (const listener of [...this.listeners]) listener() }
  setToolExpansion(id: string, key: string, details: boolean, open: boolean): void {
    const state = this.get(id), choice = { details, open }
    const owner = state.messages.find(message => message.role === 'user' && message.viewId === key)
    this.patch(id, { toolExpansions: { ...state.toolExpansions, [key]: choice, ...(owner?.runStart === undefined ? {} : { [`run:${owner.runStart}`]: choice }) } })
  }
  load(id: string, data: Partial<Conversation>, expected?: Conversation) {
    const current = this.get(id)
    // A request issued before any local edit/run must never overwrite its newer state.
    if (current.busy || (expected && current !== expected)) return
    this.patch(id, data)
  }
  /** External runs and reconnects use authoritative state; own live stream must not be double-applied. */
  synchronize(snapshot: SessionSnapshot) {
    if (this.disposed || this.runs.has(snapshot.id)) return
    const previous = this.revisions.get(snapshot.id)
    if (previous?.instance === snapshot.instance && previous.revision > snapshot.revision) return
    const current = this.get(snapshot.id)
    const viewIds = new Map<number, string>()
    for (const message of current.messages) if (message.role === 'user' && message.sourceSeq !== undefined && message.viewId) viewIds.set(message.sourceSeq, message.viewId)
    const messages = restoreTranscript(snapshot.messages, snapshot.events, snapshot.busy, snapshot.error !== null).map((message, index) => {
      if (message.role !== 'user') return message
      const previous = current.messages[index]
      const viewId = (message.sourceSeq === undefined ? undefined : viewIds.get(message.sourceSeq))
        ?? (previous?.role === 'user' && previous.content === message.content ? previous.viewId : undefined)
        ?? (message.sourceSeq === undefined ? `user:${index}` : `seq:${message.sourceSeq}`)
      return { ...message, viewId }
    })
    const retained = new Set(messages.flatMap(message => [message.viewId, message.runStart === undefined ? undefined : `run:${message.runStart}`]).filter((key): key is string => key !== undefined))
    const expansions = { ...current.toolExpansions }
    for (const message of messages) if (message.viewId && message.runStart !== undefined && expansions[message.viewId]) expansions[`run:${message.runStart}`] = expansions[message.viewId]
    this.patch(snapshot.id, {
      messages,
      toolExpansions: Object.fromEntries(Object.entries(expansions).filter(([key]) => retained.has(key))),
      busy: snapshot.busy, partial: snapshot.partial, approval: snapshot.approvals[0] ?? null,
      question: snapshot.questions[0] ?? null, tasks: snapshot.tasks, todos: snapshot.todos, jobs: snapshot.jobs,
      loop: snapshot.loop, error: snapshot.error,
      usage: normalizeSessionUsage(snapshot.usage),
      model: snapshot.model ?? null,
    })
    this.revisions.set(snapshot.id, { instance: snapshot.instance, revision: snapshot.revision })
    if (!snapshot.busy && !snapshot.error && !this.paused.has(snapshot.id)) queueMicrotask(() => { if (!this.paused.has(snapshot.id)) this.resume(snapshot.id) })
  }
  send(id: string, prompt: string, attachments: string[] = [], loop?: { args: string }) {
    if (this.disposed) throw new Error('Conversation manager is closed.')
    prompt = prompt.trim()
    if (!prompt || prompt.length > CONVERSATION_LIMITS.prompt || attachments.length > 16) throw new Error('Invalid message size.')
    const state = this.get(id)
    if (state.busy || state.queue.length) {
      if (state.queue.length >= CONVERSATION_LIMITS.queued) throw new Error('Message queue is full.')
      this.patch(id, { queue: [...state.queue, { id: crypto.randomUUID(), prompt, attachments: [...attachments], ...(loop ? { loop: { ...loop } } : {}) }] })
      if (!state.busy) this.resume(id)
    } else this.start(id, prompt, attachments, loop)
  }
  /**
   * Seed a brand-new conversation without creating a session first. The
   * backend creates the session and reports its id on the first stream event;
   * local state then migrates to that id.
   */
  sendNew(prompt: string, attachments: string[] = [], loop?: { args: string }, onCreated?: (id: string) => void): string {
    if (this.disposed) throw new Error('Conversation manager is closed.')
    prompt = prompt.trim()
    if (!prompt || prompt.length > CONVERSATION_LIMITS.prompt || attachments.length > 16) throw new Error('Invalid message size.')
    const pending = `${PENDING_SESSION_PREFIX}${crypto.randomUUID()}`
    this.get(pending)
    this.creations.set(pending, { ...(onCreated ? { onCreated } : {}) })
    return this.start(pending, prompt, attachments, loop)
  }
  editQueued(id: string, messageId: string, prompt: string) {
    if (!prompt.trim() || prompt.length > CONVERSATION_LIMITS.prompt) throw new Error('Invalid queued message.')
    prompt = prompt.trim()
    this.patch(id, { queue: this.get(id).queue.map(item => {
      if (item.id !== messageId) return item
      const { loop, ...message } = item
      if (loop && prompt === '/loop') throw new Error('Loop messages require arguments.')
      return { ...message, prompt, ...(loop && prompt.startsWith('/loop ') ? { loop: { args: prompt.slice('/loop'.length).trim() } } : {}) }
    }) })
  }
  removeQueued(id: string, messageId: string) { this.patch(id, { queue: this.get(id).queue.filter(item => item.id !== messageId) }) }
  /** Prioritize one item only after the backend has released the interrupted run. */
  async sendQueuedNow(id: string, messageId: string, interrupt: (id: string, signal: AbortSignal) => Promise<void>): Promise<boolean> {
    if (this.disposed) throw new Error('Conversation manager is closed.')
    if (isPendingSessionId(id)) throw new Error('Wait for the session to be created before sending a queued message directly.')
    const state = this.get(id), item = state.queue.find(message => message.id === messageId)
    if (!item || state.sendingQueued) return false
    if (!state.busy) { this.start(id, item.prompt, item.attachments, item.loop, item.id); return true }
    const previous = this.runs.get(id), controller = new AbortController(), token = Symbol(id)
    this.paused.add(id)
    this.runs.set(id, { token, userId: '', abort: () => controller.abort() })
    this.patch(id, { ...stoppedState(state, previous?.userId), busy: true, sendingQueued: messageId })
    try {
      previous?.abort()
      controller.signal.throwIfAborted()
      await interrupt(id, controller.signal)
      if (this.disposed || controller.signal.aborted || this.runs.get(id)?.token !== token) return false
      const next = this.get(id).queue.find(message => message.id === messageId)
      if (!next) { this.runs.delete(id); this.patch(id, { busy: false, sendingQueued: null }); return false }
      this.start(id, next.prompt, next.attachments, next.loop, next.id)
      return true
    } catch (error) {
      if (this.runs.get(id)?.token !== token) return false
      this.runs.delete(id)
      this.patch(id, { busy: false, sendingQueued: null, error: error instanceof Error ? error.message : 'Could not stop the current run. The queued message was kept.' })
      throw error
    }
  }
  discardPending(id: string | undefined): void {
    if (!id || !isPendingSessionId(id) || this.states.get(id)?.busy) return
    this.states.delete(id); this.creations.delete(id); this.paused.delete(id); this.revisions.delete(id)
  }
  resume(id: string) {
    if (this.disposed) return
    const state = this.get(id); if (state.busy) return
    this.paused.delete(id)
    if (!state.queue.length) return
    const [next] = state.queue; this.start(id, next.prompt, next.attachments, next.loop, next.id)
  }
  stop(id: string) {
    const state = this.get(id)
    this.paused.add(id)
    const run = this.runs.get(id); this.runs.delete(id); run?.abort()
    this.patch(id, stoppedState(state, run?.userId))
  }
  dispose() { this.disposed = true; for (const id of [...this.runs.keys()]) this.stop(id); this.creations.clear(); this.listeners.clear() }
  private start(
    id: string,
    prompt: string,
    attachments: string[],
    loop?: { args: string },
    queuedId?: string,
  ): string {
    const creation = this.creations.get(id)
    this.paused.delete(id)
    const token = Symbol(id), userId = crypto.randomUUID(); this.runs.set(id, { token, userId, abort() {} })
    let key = id
    this.patch(key, { busy: true, sendingQueued: queuedId ?? null, error: null, loop: null, messages: [...(creation ? [] : this.get(key).messages), { role: 'user', content: prompt, viewId: userId, runStatus: 'running' }] })
    const accepted = () => {
      if (queuedId && this.runs.get(key)?.token === token && this.get(key).sendingQueued === queuedId) this.patch(key, { sendingQueued: null, queue: this.get(key).queue.filter(item => item.id !== queuedId) })
    }
    const update = (change: (state: Conversation) => Partial<Conversation>) => {
      if (this.runs.get(key)?.token === token) this.patch(key, change(this.get(key)))
    }
    const finish = (error?: string, cancelled = false) => {
      if (this.runs.get(key)?.token !== token) return
      if (!error && !cancelled) accepted(); else this.paused.add(key)
      this.runs.delete(key)
      const state = this.get(key)
      // An externally cancelled run keeps the prefix it already streamed.
      const streamed = cancelled && state.partial?.content.trim()
        ? [{ role: 'assistant' as const, content: state.partial.content, ...(state.partial.reasoning ? { reasoning: state.partial.reasoning } : {}), runStatus: 'cancelled' as const }]
        : []
      const status = error ? 'failed' as const : cancelled ? 'cancelled' as const : 'completed' as const
      this.patch(key, { busy: false, sendingQueued: null, partial: null, approval: null, question: null, error: error ?? null, loop: null,
        ...(error && !state.draft && !state.queue.some(item => item.id === queuedId) ? { draft: prompt } : {}),
        messages: [...state.messages.map(message => message.role === 'user' && message.viewId === userId ? { ...message, runStatus: status } : message), ...streamed],
        ...(error || cancelled ? { tasks: state.tasks.map(task => task.status === 'running' ? { ...task, status: 'unknown' as const } : task), jobs: state.jobs.map(job => job.status === 'running' ? { ...job, status: 'unknown' as const } : job) } : {}) })
      this.report(error, key)
      if (!error && !cancelled) queueMicrotask(() => { if (!this.paused.has(key)) this.resume(key) })
    }
    try {
      const handle = this.transport({ ...(creation ? {} : { sessionId: key }), prompt, attachments, ...(loop ? { loop } : {}) }, {
        onToolInput: delta => update(state => {
          const partial = state.partial ?? { content: '', reasoning: '' }
          return { partial: { ...partial, toolInputs: applyToolInputDelta(partial.toolInputs, delta) } }
        }),
        onDelta: delta => update(state => {
          const partial = state.partial ?? { content: '', reasoning: '' }
          const key = delta.kind === 'reasoning' ? 'reasoning' : 'content'
          return { partial: { ...partial, [key]: (partial[key] + delta.text).slice(0, CONVERSATION_LIMITS.partial) } }
        }),
        onAssistant: message => update(state => ({ partial: null, messages: [...state.messages, { role: 'assistant', content: message.content, reasoning: message.reasoning ?? undefined, toolCalls: message.toolCalls }] })),
        onTool: message => update(state => ({ messages: [...state.messages, { role: 'tool', name: message.name, content: message.content, ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}), failed: message.error }] })),
        onApproval: approval => update(() => ({ approval })),
        onApprovalClosed: key => update(state => ({ approval: state.approval?.id === key ? null : state.approval })),
        onAsk: question => update(() => ({ question })),
        onAskClosed: key => update(state => ({ question: state.question?.id === key ? null : state.question })),
        onTodo: todos => update(() => ({ todos })),
        onUsage: usage => update(() => ({ usage: normalizeSessionUsage(usage) })),
        onLoop: status => update(() => ({ loop: status })),
        onTask: event => update(state => {
          const existing = state.tasks.find(task => task.taskId === event.taskId)
          const task: TaskSummary = existing ?? { taskId: event.taskId, parentCallId: event.parentCallId, description: event.description, mode: event.mode, model: event.model, status: 'running', startedAt: event.time, completedAt: null }
          return { tasks: [...state.tasks.filter(item => item.taskId !== event.taskId), { ...task,
            ...(event.type !== 'started' && event.type !== 'event' ? { status: event.type, completedAt: event.time } : {}),
            ...(event.result ? { content: event.result.content } : {}), ...(event.reason ? { reason: event.reason } : {}),
            ...(event.event ? { activity: `${event.event.toolName ?? event.event.type} · ${event.event.turn}` } : {}) }] }
        }),
        onJob: event => update(state => {
          const data = event.data && typeof event.data === 'object' ? event.data as Partial<JobSummary> & { content?: string } : {}
          const previous = state.jobs.find(job => job.jobId === event.jobId)
          if (previous && event.seq <= previous.lastSeq) return {}
          const job: JobSummary = previous ?? { jobId: event.jobId, kind: event.kind, description: data.description ?? event.kind, status: 'running', background: data.background === true, lastSeq: -1 }
          const status = ['completed', 'failed', 'cancelled'].includes(event.type) ? event.type as JobSummary['status'] : job.status
          const output = event.type === 'stdout' || event.type === 'stderr' ? `${job.output ?? ''}${data.content ?? '[truncated event]'}`.slice(-32768) : job.output
          return { jobs: [...state.jobs.filter(item => item.jobId !== event.jobId), { ...job, status, output, background: event.type === 'background' || job.background, lastSeq: event.seq, result: data.result ?? job.result }] }
        }),
        onSession: sessionId => {
          if (!creation && sessionId === key) { accepted(); return }
          if (!creation || this.creations.get(key) !== creation || this.runs.get(key)?.token !== token || !sessionId || isPendingSessionId(sessionId) || sessionId === key) return
          const state = this.states.get(key)
          const run = this.runs.get(key)
          this.states.delete(key); this.paused.delete(key); this.revisions.delete(key); this.creations.delete(key)
          if (state) this.states.set(sessionId, { ...state, draft: this.states.get(sessionId)?.draft || state.draft })
          if (run) { this.runs.delete(key); this.runs.set(sessionId, run) }
          key = sessionId
          accepted()
          creation.onCreated?.(sessionId)
        },
        onSessionMeta: () => this.report(undefined, key), onDone: () => finish(), onCancelled: () => finish(undefined, true), onError: finish, onUnauthorized: () => finish('Unauthorized'),
      })
      if (this.runs.get(key)?.token === token) this.runs.set(key, { token, userId, ...handle })
    } catch (error) { finish(error instanceof Error ? error.message : 'Request failed.') }
    return key
  }
}
