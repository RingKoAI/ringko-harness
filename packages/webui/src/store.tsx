import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  UnauthorizedError,
  createSession,
  fetchInfo,
  fetchSession,
  fetchSessions,
  respondApproval,
  streamChat,
  type Approval,
  type Info,
  type ServerMessage,
  type SessionMeta,
} from '@/api'

export interface AppState {
  info: Info | null
  unauthorized: boolean
  refreshInfo(): void
  refreshSessions(): void
  clearSession(): void
  sessions: SessionMeta[]
  sessionId: string | undefined
  messages: ServerMessage[]
  busy: boolean
  approval: Approval | null
  send(prompt: string, attachments?: string[]): void
  stop(): void
  decide(approved: boolean): void
  openSession(id: string): void
  newChat(): void
}

const AppContext = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<Info | null>(null)
  const [unauthorized, setUnauthorized] = useState(false)
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [messages, setMessages] = useState<ServerMessage[]>([])
  const [sessionId, setSessionId] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [approval, setApproval] = useState<Approval | null>(null)
  const streamRef = useRef<{ abort(): void } | null>(null)

  const refreshSessions = useCallback(() => {
    fetchSessions()
      .then(setSessions)
      .catch((cause: unknown) => {
        if (cause instanceof UnauthorizedError) setUnauthorized(true)
      })
  }, [])

  const refreshInfo = useCallback(() => {
    fetchInfo()
      .then((value) => {
        setInfo(value)
        setUnauthorized(false)
      })
      .catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : String(cause)))
  }, [])

  useEffect(() => {
    refreshInfo()
  }, [refreshInfo])

  useEffect(() => {
    if (info) refreshSessions()
  }, [info, refreshSessions])

  const send = useCallback(
    (prompt: string, attachments?: string[]) => {
      setMessages((previous) => [...previous, { role: 'user', content: prompt }])
      setBusy(true)
      streamRef.current = streamChat({ prompt, ...(sessionId ? { sessionId } : {}), ...(attachments && attachments.length > 0 ? { attachments } : {}) }, {
        onAssistant: (message) =>
          setMessages((previous) => [
            ...previous,
            {
              role: 'assistant',
              content: message.content,
              ...(message.reasoning ? { reasoning: message.reasoning } : {}),
              toolCalls: message.toolCalls,
            },
          ]),
        onTool: (message) =>
          setMessages((previous) => [...previous, { role: 'tool', name: message.name, content: message.content }]),
        onApproval: (value) => setApproval(value),
        onDone: (result) => {
          setSessionId(result.sessionId)
          setBusy(false)
          refreshSessions()
        },
        onError: (message) => {
          toast.error(message)
          setBusy(false)
        },
        onUnauthorized: () => {
          setBusy(false)
          setUnauthorized(true)
        },
      })
    },
    [sessionId, refreshSessions],
  )

  const stop = useCallback(() => {
    streamRef.current?.abort()
    setBusy(false)
  }, [])

  const decide = useCallback(
    (approved: boolean) => {
      const current = approval
      if (!current) return
      setApproval(null)
      void respondApproval(current.id, approved).catch(() => {})
    },
    [approval],
  )

  const openSession = useCallback((id: string) => {
    fetchSession(id)
      .then((data) => {
        setSessionId(id)
        setMessages(data.messages)
        setApproval(null)
      })
      .catch((cause: unknown) => {
        if (cause instanceof UnauthorizedError) setUnauthorized(true)
        else toast.error(cause instanceof Error ? cause.message : String(cause))
      })
  }, [])

  const newChat = useCallback(() => {
    setMessages([])
    setApproval(null)
    createSession()
      .then((meta) => {
        setSessionId(meta.id)
        refreshSessions()
      })
      .catch((cause: unknown) => {
        if (cause instanceof UnauthorizedError) setUnauthorized(true)
        else toast.error(cause instanceof Error ? cause.message : String(cause))
      })
  }, [refreshSessions])

  const clearSession = useCallback(() => {
    setMessages([])
    setSessionId(undefined)
    setApproval(null)
  }, [])

  const value = useMemo<AppState>(
    () => ({
      info,
      unauthorized,
      refreshInfo,
      refreshSessions,
      clearSession,
      sessions,
      sessionId,
      messages,
      busy,
      approval,
      send,
      stop,
      decide,
      openSession,
      newChat,
    }),
    [info, unauthorized, refreshInfo, refreshSessions, clearSession, sessions, sessionId, messages, busy, approval, send, stop, decide, openSession, newChat],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppState {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used within an AppProvider')
  return context
}
