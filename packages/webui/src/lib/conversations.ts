import type { Approval, ChatHandlers, JobSummary, QuestionRequest, ServerMessage, TaskSummary, TodoItem } from '../api'

export const CONVERSATION_LIMITS = { queued: 16, prompt: 65536, partial: 262144, cached: 64 } as const
export interface QueuedMessage { id: string; prompt: string; attachments: string[] }
export interface Conversation {
  messages: ServerMessage[]; busy: boolean; approval: Approval | null; question: QuestionRequest | null
  tasks: TaskSummary[]; jobs: JobSummary[]; todos: TodoItem[]; queue: QueuedMessage[]
  partial: { content: string; reasoning: string } | null; draft: string; error: string | null
}
export const emptyConversation = (): Conversation => ({ messages: [], busy: false, approval: null, question: null, tasks: [], jobs: [], todos: [], queue: [], partial: null, draft: '', error: null })
type Transport = (input: { sessionId: string; prompt: string; attachments: string[] }, handlers: ChatHandlers) => { abort(): void }

/** Owns each stream independently of the currently visible route. Late callbacks are discarded. */
export class Conversations {
  private states = new Map<string, Conversation>()
  private runs = new Map<string, { token: symbol; abort(): void }>()
  private listeners = new Set<() => void>()
  private disposed = false
  private transport: Transport
  private report: (error?: string) => void
  constructor(transport: Transport, report: (error?: string) => void) { this.transport = transport; this.report = report }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  peek(id: string): Conversation | undefined { return this.states.get(id) }
  get(id: string): Conversation {
    let state = this.states.get(id)
    if (!state) {
      if (this.states.size >= CONVERSATION_LIMITS.cached) {
        const disposable = [...this.states].find(([, item]) => !item.busy && !item.queue.length && !item.draft)
        if (!disposable) throw new Error('Conversation cache is full. Finish or clear a queued conversation.')
        this.states.delete(disposable[0])
      }
      state = emptyConversation(); this.states.set(id, state)
    }
    return state
  }
  patch(id: string, patch: Partial<Conversation>) { this.states.set(id, { ...this.get(id), ...patch }); for (const listener of [...this.listeners]) listener() }
  load(id: string, data: Partial<Conversation>, expected?: Conversation) {
    const current = this.get(id)
    // A request issued before any local edit/run must never overwrite its newer state.
    if (current.busy || (expected && current !== expected)) return
    this.patch(id, data)
  }
  send(id: string, prompt: string, attachments: string[] = []) {
    if (this.disposed) throw new Error('Conversation manager is closed.')
    prompt = prompt.trim()
    if (!prompt || prompt.length > CONVERSATION_LIMITS.prompt || attachments.length > 16) throw new Error('Invalid message size.')
    const state = this.get(id)
    if (state.busy || state.queue.length) {
      if (state.queue.length >= CONVERSATION_LIMITS.queued) throw new Error('Message queue is full.')
      this.patch(id, { queue: [...state.queue, { id: crypto.randomUUID(), prompt, attachments: [...attachments] }] })
      if (!state.busy) this.resume(id)
    } else this.start(id, prompt, attachments)
  }
  editQueued(id: string, messageId: string, prompt: string) {
    if (!prompt.trim() || prompt.length > CONVERSATION_LIMITS.prompt) throw new Error('Invalid queued message.')
    this.patch(id, { queue: this.get(id).queue.map(item => item.id === messageId ? { ...item, prompt: prompt.trim() } : item) })
  }
  removeQueued(id: string, messageId: string) { this.patch(id, { queue: this.get(id).queue.filter(item => item.id !== messageId) }) }
  resume(id: string) {
    if (this.disposed) return
    const state = this.get(id); if (state.busy || !state.queue.length) return
    const [next, ...queue] = state.queue; this.patch(id, { queue }); this.start(id, next.prompt, next.attachments)
  }
  stop(id: string) {
    const run = this.runs.get(id); this.runs.delete(id); run?.abort()
    const state = this.get(id)
    this.patch(id, { busy: false, partial: null, approval: null, question: null,
      tasks: state.tasks.map(task => task.status === 'running' ? { ...task, status: 'unknown' } : task),
      jobs: state.jobs.map(job => job.status === 'running' ? { ...job, status: 'unknown' } : job) })
  }
  dispose() { this.disposed = true; for (const id of [...this.runs.keys()]) this.stop(id); this.listeners.clear() }
  private start(id: string, prompt: string, attachments: string[]) {
    const token = Symbol(id); this.runs.set(id, { token, abort() {} })
    this.patch(id, { busy: true, error: null, messages: [...this.get(id).messages, { role: 'user', content: prompt }] })
    const update = (change: (state: Conversation) => Partial<Conversation>) => {
      if (this.runs.get(id)?.token === token) this.patch(id, change(this.get(id)))
    }
    const finish = (error?: string) => {
      if (this.runs.get(id)?.token !== token) return
      this.runs.delete(id)
      const state = this.get(id)
      this.patch(id, { busy: false, partial: null, approval: null, question: null, error: error ?? null,
        ...(error ? { tasks: state.tasks.map(task => task.status === 'running' ? { ...task, status: 'unknown' as const } : task), jobs: state.jobs.map(job => job.status === 'running' ? { ...job, status: 'unknown' as const } : job) } : {}) })
      this.report(error)
      if (!error) queueMicrotask(() => this.resume(id))
    }
    try {
      const handle = this.transport({ sessionId: id, prompt, attachments }, {
        onDelta: delta => update(state => {
          const partial = state.partial ?? { content: '', reasoning: '' }
          const key = delta.kind === 'reasoning' ? 'reasoning' : 'content'
          return { partial: { ...partial, [key]: (partial[key] + delta.text).slice(0, CONVERSATION_LIMITS.partial) } }
        }),
        onAssistant: message => update(state => ({ partial: null, messages: [...state.messages, { role: 'assistant', content: message.content, reasoning: message.reasoning ?? undefined, toolCalls: message.toolCalls }] })),
        onTool: message => update(state => ({ messages: [...state.messages, { role: 'tool', name: message.name, content: message.content }] })),
        onApproval: approval => update(() => ({ approval })),
        onApprovalClosed: key => update(state => ({ approval: state.approval?.id === key ? null : state.approval })),
        onAsk: question => update(() => ({ question })),
        onAskClosed: key => update(state => ({ question: state.question?.id === key ? null : state.question })),
        onTodo: todos => update(() => ({ todos })),
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
        onDone: () => finish(), onError: finish, onUnauthorized: () => finish('Unauthorized'),
      })
      if (this.runs.get(id)?.token === token) this.runs.set(id, { token, ...handle })
    } catch (error) { finish(error instanceof Error ? error.message : 'Request failed.') }
  }
}
