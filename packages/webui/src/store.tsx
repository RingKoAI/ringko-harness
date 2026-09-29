import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { UnauthorizedError, createSession, fetchInfo, fetchSession, fetchSessions, respondApproval, streamChat, stopSession, answerQuestion, jobAction, type QuestionOutput, type Info, type SessionMeta } from '@/api'
import { Conversations, emptyConversation, type Conversation } from '@/lib/conversations'

export interface AppState extends Conversation {
  info: Info | null; unauthorized: boolean; sessions: SessionMeta[]; sessionId: string | undefined
  refreshInfo(): void; refreshSessions(): void; clearSession(): void
  answer(output?: QuestionOutput): void; controlJob(id: string, action: 'status' | 'cancel' | 'background'): void
  send(prompt: string, attachments?: string[]): void; stop(): void; decide(approved: boolean, scope?: 'session' | 'saved'): void
  openSession(id: string): void; newChat(): void; setDraft(value: string): void
  editQueued(id: string, prompt: string): void; removeQueued(id: string): void; resumeQueue(): void
  runningSessions: string[]
}
const AppContext = createContext<AppState | null>(null)
const blank = emptyConversation()
const reportError = (cause: unknown) => toast.error(cause instanceof Error ? cause.message : String(cause))

export function AppProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<Info | null>(null)
  const [unauthorized, setUnauthorized] = useState(false)
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [sessionId, setSessionId] = useState<string>()
  const [newDraft, setNewDraft] = useState('')
  const newDraftRef = useRef('')
  const selected = useRef<string | undefined>(undefined)
  const selectionVersion = useRef(0)
  const [revision, setRevision] = useState(0)
  const refreshSessions = useCallback(() => { fetchSessions().then(setSessions).catch(cause => { if (cause instanceof UnauthorizedError) setUnauthorized(true) }) }, [])
  const refreshInfo = useCallback(() => { fetchInfo().then(value => { setInfo(value); setUnauthorized(false) }).catch(reportError) }, [])
  const [conversations] = useState(() => new Conversations(streamChat, error => { if (error === 'Unauthorized') setUnauthorized(true); else if (error) toast.error(error); refreshSessions() }))
  useEffect(() => conversations.subscribe(() => setRevision(value => value + 1)), [conversations])
  // Delayed disposal tolerates React StrictMode's setup/cleanup/setup probe.
  const disposal = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => { clearTimeout(disposal.current); return () => { disposal.current = setTimeout(() => conversations.dispose(), 0) } }, [conversations])
  useEffect(() => { refreshInfo() }, [refreshInfo])
  useEffect(() => { if (info) refreshSessions() }, [info, refreshSessions])
  const select = useCallback((id?: string) => { selected.current = id; setSessionId(id); selectionVersion.current++ }, [])
  const openSession = useCallback((id: string) => {
    let expected: Conversation
    try { expected = conversations.get(id) } catch (error) { reportError(error); return }
    select(id)
    if (expected.busy) return
    fetchSession(id).then(data => conversations.load(id, { messages: data.messages, tasks: data.tasks ?? [], jobs: data.jobs ?? [], todos: data.todos ?? [] }, expected)).catch(reportError)
  }, [conversations, select])
  const creating = useRef<Promise<string> | null>(null)
  const ensureSession = useCallback(() => {
    if (selected.current) return Promise.resolve(selected.current)
    if (!creating.current) {
      const version = selectionVersion.current
      creating.current = createSession().then(meta => { conversations.get(meta.id); if (selectionVersion.current === version) { conversations.patch(meta.id, { draft: newDraftRef.current }); newDraftRef.current = ''; setNewDraft(''); select(meta.id) }; refreshSessions(); return meta.id }).finally(() => { creating.current = null })
    }
    return creating.current
  }, [conversations, select, refreshSessions])
  const send = useCallback((prompt: string, attachments?: string[]) => {
    void ensureSession().then(id => conversations.send(id, prompt, attachments)).catch(reportError)
  }, [conversations, ensureSession])
  const newChat = useCallback(() => {
    newDraftRef.current = ''; setNewDraft(''); select()
    const version = selectionVersion.current
    void createSession().then(meta => { conversations.get(meta.id); if (selectionVersion.current === version) select(meta.id); refreshSessions() }).catch(reportError)
  }, [select, conversations, refreshSessions])
  const stop = useCallback(() => {
    const id = selected.current; if (!id) return
    conversations.stop(id); void stopSession(id).catch(reportError)
  }, [conversations])
  const answer = useCallback((output?: QuestionOutput) => { const id = selected.current; const question = id ? conversations.get(id).question : null; if (question) void answerQuestion(question.id, output).catch(reportError) }, [conversations])
  const decide = useCallback((approved: boolean, scope?: 'session' | 'saved') => {
    const id = selected.current; const approval = id ? conversations.get(id).approval : null
    if (id && approval) void respondApproval(approval.id, approved, scope).then(() => { if (conversations.get(id).approval?.id === approval.id) conversations.patch(id, { approval: null }) }).catch(reportError)
  }, [conversations])
  const controlJob = useCallback((jobId: string, action: 'status' | 'cancel' | 'background') => {
    const id = selected.current; if (!id) return
    void jobAction(id, jobId, action).then(job => conversations.patch(id, { jobs: conversations.get(id).jobs.map(item => item.jobId === jobId ? { ...item, ...job } : item) })).catch(reportError)
  }, [conversations])
  const state = useMemo(() => { void revision; return sessionId ? conversations.get(sessionId) : { ...blank, draft: newDraft } }, [sessionId, conversations, revision, newDraft])
  const value = useMemo<AppState>(() => ({ ...state, info, unauthorized, sessions, sessionId, refreshInfo, refreshSessions, openSession, newChat, send, stop, answer, decide, controlJob,
    clearSession: () => select(), setDraft: draft => { if (selected.current) conversations.patch(selected.current, { draft }); else { newDraftRef.current = draft; setNewDraft(draft) } },
    editQueued: (id, prompt) => { if (selected.current) { try { conversations.editQueued(selected.current, id, prompt) } catch (error) { reportError(error) } } },
    removeQueued: id => { if (selected.current) conversations.removeQueued(selected.current, id) },
    resumeQueue: () => { if (selected.current) conversations.resume(selected.current) },
    runningSessions: sessions.filter(item => conversations.peek(item.id)?.busy).map(item => item.id),
  }), [state, info, unauthorized, sessions, sessionId, refreshInfo, refreshSessions, openSession, newChat, send, stop, answer, decide, controlJob, select, conversations])
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
export function useApp(): AppState { const context = useContext(AppContext); if (!context) throw new Error('useApp must be used within an AppProvider'); return context }
