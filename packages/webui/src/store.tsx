import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { UnauthorizedError, backendClient, fetchInfo, fetchSnapshot, fetchSessions, respondApproval, steerSession, streamChat, stopSession, stopSessionAndWait, answerQuestion, jobAction, type QuestionOutput, type Info, type SessionMeta } from '@/api'
import { BackendError } from '@ringko-ai/client'
import { Conversations, emptyConversation, isPendingSessionId, type Conversation } from '@/lib/conversations'

export interface AppState extends Conversation {
  info: Info | null; unauthorized: boolean; sessions: SessionMeta[]; sessionId: string | undefined
  refreshInfo(): void; refreshSessions(): void; clearSession(): void
  answer(output?: QuestionOutput): void; controlJob(id: string, action: 'status' | 'cancel' | 'background'): void
  send(prompt: string, attachments?: string[], loop?: { args: string }): boolean; steer(prompt: string, attachments?: string[]): boolean; sendTo(id: string, prompt: string): void; stop(): void; decide(approved: boolean, scope?: 'session' | 'saved'): void
  openSession(id: string): void; newChat(): void; setDraft(value: string): void
  editQueued(id: string, prompt: string): void; removeQueued(id: string): void; resumeQueue(): void; sendQueuedNow(id: string): Promise<boolean>; steerQueued(id: string): Promise<boolean>; steerAllQueued(): Promise<number>
  runningSessions: string[]
  setToolExpansion(key: string, details: boolean, open: boolean): void
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
  const selected = useRef<string | undefined>(undefined)
  const selectionVersion = useRef(0)
  const [revision, setRevision] = useState(0)
  const refreshSessions = useCallback(() => { fetchSessions().then(setSessions).catch(cause => { if (cause instanceof UnauthorizedError) setUnauthorized(true) }) }, [])
  const refreshInfo = useCallback(() => { fetchInfo().then(value => { setInfo(value); setUnauthorized(false) }).catch(reportError) }, [])
  const [conversations] = useState<Conversations>(() => new Conversations(streamChat, (error, id) => {
    if (error === 'Unauthorized') setUnauthorized(true); else if (error) toast.error(error)
    refreshSessions()
    if (id && !isPendingSessionId(id)) void fetchSnapshot(id).then(snapshot => conversations.synchronize(snapshot)).catch(reportError)
  }, steerSession))
  useEffect(() => conversations.subscribe(() => setRevision(value => value + 1)), [conversations])
  // Delayed disposal tolerates React StrictMode's setup/cleanup/setup probe.
  const disposal = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => { clearTimeout(disposal.current); return () => { disposal.current = setTimeout(() => conversations.dispose(), 0) } }, [conversations])
  useEffect(() => { refreshInfo() }, [refreshInfo])
  useEffect(() => { if (info) refreshSessions() }, [info, refreshSessions])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const watch = backendClient.watch(notice => {
      if (notice.kind === 'activity') return
      if (!timer) timer = setTimeout(() => { timer = undefined; refreshSessions(); if (notice.kind !== 'session') refreshInfo() }, 150)
    }, error => { if (error instanceof BackendError && error.status === 401) setUnauthorized(true) })
    return () => { clearTimeout(timer); watch.close() }
  }, [refreshSessions, refreshInfo, unauthorized])
  useEffect(() => {
    if (!sessionId || isPendingSessionId(sessionId)) return
    const subscription = backendClient.watchSession(sessionId, snapshot => conversations.synchronize(snapshot), error => {
      if (error instanceof BackendError && error.status === 401) setUnauthorized(true)
      else if (error instanceof BackendError && error.status === 404) { conversations.patch(sessionId, { busy: false, error: 'Session was deleted in another client.' }); refreshSessions() }
    })
    return () => subscription.close()
  }, [sessionId, conversations, refreshSessions, unauthorized])
  const select = useCallback((id?: string) => { selected.current = id; setSessionId(id); selectionVersion.current++ }, [])
  const openSession = useCallback((id: string) => {
    if (isPendingSessionId(id)) { if (conversations.peek(id)) select(id); return }
    let expected: Conversation
    try { expected = conversations.get(id) } catch (error) { reportError(error); return }
    select(id)
    if (expected.busy) return
    fetchSnapshot(id).then(data => { if (conversations.get(id) === expected) conversations.synchronize(data) }).catch(reportError)
  }, [conversations, select])
  const send = useCallback((prompt: string, attachments?: string[], loop?: { args: string }) => {
    let editing: { id: string; draft: string } | undefined
    try {
      const id = selected.current
      if (id) {
        editing = { id, draft: conversations.get(id).draft }
        conversations.patch(id, { draft: '' })
        conversations.send(id, prompt, attachments, loop)
        return true
      }
      const version = selectionVersion.current
      let pending: string | undefined
      pending = conversations.sendNew(prompt, attachments, loop, created => {
        if (selectionVersion.current === version || selected.current === pending) select(created)
        refreshSessions()
      })
      setNewDraft('')
      if (selectionVersion.current === version) select(pending)
      return true
    } catch (error) {
      if (editing) conversations.patch(editing.id, { draft: editing.draft })
      reportError(error); return false
    }
  }, [conversations, select, refreshSessions])
  /** Select a session and start a run without fetching its snapshot first. */
  const sendTo = useCallback((id: string, prompt: string) => {
    select(id)
    try { conversations.get(id); conversations.send(id, prompt) } catch (error) { reportError(error) }
  }, [conversations, select])
  const newChat = useCallback(() => {
    conversations.discardPending(selected.current)
    setNewDraft(''); select()
  }, [conversations, select])
  const stop = useCallback(() => {
    const id = selected.current; if (!id) return
    conversations.stop(id); if (!isPendingSessionId(id)) void stopSession(id).catch(reportError)
  }, [conversations])
  const answer = useCallback((output?: QuestionOutput) => { const id = selected.current; const question = id ? conversations.get(id).question : null; if (question) void answerQuestion(question.id, output).catch(reportError) }, [conversations])
  const sendQueuedNow = useCallback(async (messageId: string): Promise<boolean> => {
    const id = selected.current; if (!id) return false
    try { return await conversations.sendQueuedNow(id, messageId, stopSessionAndWait) }
    catch (error) {
      if (error instanceof UnauthorizedError || error instanceof BackendError && error.status === 401) setUnauthorized(true)
      reportError(error)
      if (!isPendingSessionId(id)) void fetchSnapshot(id).then(snapshot => conversations.synchronize(snapshot)).catch(reportError)
      return false
    }
  }, [conversations])
  const steer = useCallback((prompt: string, attachments?: string[]): boolean => {
    const id = selected.current
    if (!id) return send(prompt, attachments)
    const previousDraft = conversations.get(id).draft
    try {
      conversations.patch(id, { draft: '' })
      void conversations.steer(id, prompt, attachments).catch(error => {
        if (error instanceof UnauthorizedError || error instanceof BackendError && error.status === 401) setUnauthorized(true)
        reportError(error)
      })
      return true
    } catch (error) {
      conversations.patch(id, { draft: previousDraft })
      reportError(error)
      return false
    }
  }, [conversations, send])
  const steerQueued = useCallback(async (messageId: string): Promise<boolean> => {
    const id = selected.current; if (!id) return false
    try { return await conversations.steerQueued(id, messageId) }
    catch (error) {
      if (error instanceof UnauthorizedError || error instanceof BackendError && error.status === 401) setUnauthorized(true)
      reportError(error)
      return false
    }
  }, [conversations])
  const steerAllQueued = useCallback(async (): Promise<number> => {
    const id = selected.current; if (!id) return 0
    try { return await conversations.steerAllQueued(id) }
    catch (error) {
      if (error instanceof UnauthorizedError || error instanceof BackendError && error.status === 401) setUnauthorized(true)
      reportError(error)
      return 0
    }
  }, [conversations])
  const decide = useCallback((approved: boolean, scope?: 'session' | 'saved') => {
    const id = selected.current; const approval = id ? conversations.get(id).approval : null
    if (id && approval) void respondApproval(approval.id, approved, scope).then(() => { if (conversations.get(id).approval?.id === approval.id) conversations.patch(id, { approval: null }) }).catch(reportError)
  }, [conversations])
  const controlJob = useCallback((jobId: string, action: 'status' | 'cancel' | 'background') => {
    const id = selected.current; if (!id) return
    void jobAction(id, jobId, action).then(job => conversations.patch(id, { jobs: conversations.get(id).jobs.map(item => item.jobId === jobId ? { ...item, ...job } : item) })).catch(reportError)
  }, [conversations])
  const state = useMemo(() => { void revision; return sessionId ? conversations.get(sessionId) : { ...blank, draft: newDraft } }, [sessionId, conversations, revision, newDraft])
  const value = useMemo<AppState>(() => ({ ...state, info, unauthorized, sessions, sessionId, refreshInfo, refreshSessions, openSession, newChat, send, steer, sendTo, stop, answer, decide, controlJob, sendQueuedNow, steerQueued, steerAllQueued,
    setToolExpansion: (key, details, open) => { if (sessionId) conversations.setToolExpansion(sessionId, key, details, open) },
    clearSession: () => select(), setDraft: draft => { if (selected.current) conversations.patch(selected.current, { draft }); else setNewDraft(draft) },
    editQueued: (id, prompt) => { if (selected.current) { try { conversations.editQueued(selected.current, id, prompt) } catch (error) { reportError(error) } } },
    removeQueued: id => { if (selected.current) conversations.removeQueued(selected.current, id) },
    resumeQueue: () => { if (selected.current) conversations.resume(selected.current) },
    runningSessions: sessions.filter(item => item.busy || conversations.peek(item.id)?.busy).map(item => item.id),
  }), [state, info, unauthorized, sessions, sessionId, refreshInfo, refreshSessions, openSession, newChat, send, steer, sendTo, stop, answer, decide, controlJob, sendQueuedNow, steerQueued, steerAllQueued, select, conversations])
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
export function useApp(): AppState { const context = useContext(AppContext); if (!context) throw new Error('useApp must be used within an AppProvider'); return context }
