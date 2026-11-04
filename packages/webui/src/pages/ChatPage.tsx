import { Activity, ArrowDown, ArrowUp, Brain, Folder, GitBranch, ListTree, MessageSquare, Paperclip, Pencil, Square, Terminal, ThumbsDown, ThumbsUp, User, Wrench, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type SetStateAction } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  compact,
  fetchContext,
  fetchFeedback,
  forkSession,
  reload,
  sendFeedback,
  setUi,
  uploadFile,
  type ServerMessage,
  type UploadedFile,
} from '@/api'
import { LandingGreeting } from '@/components/landing-greeting'
import { AccessPicker } from '@/components/access-picker'
import { QueuePanel } from '@/components/queue-panel'
import type { RightSidebarTab } from '@/components/right-sidebar'
import { ModePicker } from '@/components/mode-picker'
import { ComposerStatus } from '@/components/composer-status'
import { Markdown } from '@/components/markdown'
import { ModelPicker } from '@/components/model-picker'
import { ThinkingPicker } from '@/components/thinking-picker'
import { TodoPanel } from '@/components/todo-panel'
import { QuestionPanel } from '@/components/question-panel'
import { TrajectoryView } from '@/components/trajectory-view'
import { TaskView } from '@/components/task-view'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { useI18n, type MessageKey } from '@/i18n'
import { useApp } from '@/store'
import { cn } from '@/lib/utils'
import { matchToolResults } from '@/lib/tool-activity'
import { isNearBottom, scrollMetrics } from '@/lib/chat-scroll'
import { CopyButton } from '@/components/chat/copy-button'
import { ToolActivityGroup, ToolResult, toolSummary } from '@/components/chat/tool-activity'
import { BrandMark } from '@/components/brand-mark'

const COMMANDS: { name: string; label: MessageKey }[] = [
  { name: 'reload', label: 'command.reload' },
  { name: 'compact', label: 'command.compact' },
  { name: 'loop', label: 'command.loop' },
]

function MessageRow({
  message,
  index,
  forkIndex,
  showThinking,
  showTools,
  onBranch,
  onEdit,
  onFeedback,
  feedback,
  toolResults,
  busy,
}: {
  message: ServerMessage
  index: number
  forkIndex: number
  showThinking: boolean
  showTools: boolean
  onBranch: (index: number) => void
  onEdit: (index: number, content: string) => Promise<boolean>
  onFeedback: (index: number, value: 'up' | 'down') => void
  feedback?: 'up' | 'down'
  toolResults?: ReadonlyMap<string, ServerMessage>
  busy: boolean
}) {
  const { t } = useI18n()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const [saving, setSaving] = useState(false)
  const isUser = message.role === 'user'
  const isTool = message.role === 'tool'
  const canEdit = isUser && !busy && message.content.length > 0
  const save = async (): Promise<void> => {
    const next = draft.trim()
    if (next.length === 0 || next === message.content) { setEditing(false); return }
    setSaving(true)
    try {
      if (await onEdit(forkIndex, next)) setEditing(false)
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="group min-w-0 space-y-2" data-chat-message>
      <div className="flex items-center gap-2">
        <div
          className={cn(
            'mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ring-1 ring-border',
            isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
          )}
        >
          {isUser ? <User className="size-3.5" /> : isTool ? <Terminal className="size-3.5" /> : <Brain className="size-3.5" />}
        </div>
        <div className="text-xs font-medium text-muted-foreground">
          {isUser ? t('message.you') : isTool ? t('message.tool', { name: message.name ?? '' }) : t('message.assistant')}
        </div>
      </div>
      <div className="min-w-0 space-y-2">
        {message.reasoning && showThinking ? (
          <Card className="gap-0 border-dashed bg-muted/30 py-0 shadow-none">
            <CardContent className="px-3 py-2">
              <details>
                <summary className="cursor-pointer text-xs text-muted-foreground">{t('message.reasoning')}</summary>
                <pre className="mt-1 font-mono text-xs whitespace-pre-wrap text-muted-foreground">{message.reasoning}</pre>
              </details>
            </CardContent>
          </Card>
        ) : null}
        {message.content ? (
          isTool ? (
            showTools ? (
              <ToolResult message={message} t={t} />
            ) : (
              <p className="truncate text-xs text-muted-foreground">
                  <span className="font-mono">{message.name}</span> · {message.failed ? `${t('message.failed')} · ` : ''}{toolSummary(t, message.name, message.content)}
              </p>
            )
          ) : isUser ? (
            editing ? (
              <div className="space-y-2">
                <textarea
                  className="min-h-20 w-full resize-y rounded-md border bg-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={draft}
                  onChange={event => setDraft(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Escape') { event.preventDefault(); setEditing(false) }
                    else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void save() }
                  }}
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>{t('message.cancel')}</Button>
                  <Button size="sm" disabled={saving || !draft.trim() || draft.trim() === message.content} onClick={() => void save()}>{t('message.save')}</Button>
                </div>
              </div>
            ) : (
              <div className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</div>
            )
          ) : (
            <Markdown content={message.content} />
          )
        ) : null}
        {message.toolCalls && message.toolCalls.length > 0 ? <ToolActivityGroup calls={message.toolCalls} results={toolResults} busy={busy} showDetails={showTools} t={t} /> : null}
        {!isTool ? (
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
            {message.content ? (
              <CopyButton text={message.content} t={t} />
            ) : null}
            {canEdit && !editing ? (
              <Button variant="ghost" size="icon" className="size-6" title={t('message.edit')} onClick={() => { setDraft(message.content); setEditing(true) }}>
                <Pencil className="size-3" />
              </Button>
            ) : null}
            <Button variant="ghost" size="icon" className="size-6" title={t('message.branch')} onClick={() => onBranch(forkIndex)}>
              <GitBranch className="size-3" />
            </Button>
            {!isUser && message.content ? (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn('size-6', feedback === 'up' && 'text-primary')}
                  title={t('message.good')}
                  onClick={() => onFeedback(index, 'up')}
                >
                  <ThumbsUp className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn('size-6', feedback === 'down' && 'text-destructive')}
                  title={t('message.bad')}
                  onClick={() => onFeedback(index, 'down')}
                >
                  <ThumbsDown className="size-3" />
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function ChatPage() {
  const { t } = useI18n()
  const app = useApp()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { openRightSidebar } = useOutletContext<{ openRightSidebar(tab: RightSidebarTab): void }>()
  const draft = app.draft
  const setDraft = app.setDraft
  const [attachmentDrafts, setAttachmentDrafts] = useState<Record<string, UploadedFile[]>>({})
  const attachmentKey = app.sessionId ?? 'new'
  const attachments = attachmentDrafts[attachmentKey] ?? []
  const setAttachments = (value: SetStateAction<UploadedFile[]>) => setAttachmentDrafts(previous => ({ ...previous, [attachmentKey]: typeof value === 'function' ? value(previous[attachmentKey] ?? []) : value }))
  const [context, setContext] = useState<{ used: number; limit: number } | null>(null)
  const [view, setView] = useState<'chat' | 'trajectory'>('chat')
  const [taskView, setTaskView] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Record<number, 'up' | 'down'>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollRootRef = useRef<HTMLDivElement>(null)
  const scrollViewportRef = useRef<HTMLElement | null>(null)
  const followingRef = useRef(true)
  const lastSessionRef = useRef(app.sessionId)
  const [jumpVisible, setJumpVisible] = useState(false)
  const [unreadTail, setUnreadTail] = useState(false)

  // Bind the transcript viewport and track whether the reader left the tail.
  useEffect(() => {
    if (view !== 'chat' || taskView) return
    const viewport = scrollRootRef.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
    if (!viewport) return
    scrollViewportRef.current = viewport
    const update = (): void => {
      const following = isNearBottom(scrollMetrics(viewport))
      followingRef.current = following
      setJumpVisible(!following)
      if (following) setUnreadTail(false)
    }
    viewport.addEventListener('scroll', update, { passive: true })
    update()
    return () => {
      viewport.removeEventListener('scroll', update)
      scrollViewportRef.current = null
    }
  }, [view, taskView])

  // A session change starts at the latest message with following re-enabled.
  useEffect(() => {
    if (lastSessionRef.current === app.sessionId) return
    lastSessionRef.current = app.sessionId
    followingRef.current = true
    setJumpVisible(false)
    setUnreadTail(false)
    const viewport = scrollViewportRef.current
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [app.sessionId])

  // Keep the tail in view only while the reader is following it; otherwise mark
  // the new content as unread and let their position stand.
  useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return
    if (followingRef.current) viewport.scrollTop = viewport.scrollHeight
    else setUnreadTail(true)
  }, [app.sessionId, app.messages.length, app.partial?.content, app.partial?.reasoning, app.busy, app.approval, app.question, app.todos, app.tasks, app.jobs])

  // Load the session named by the URL (deep link / refresh).
  useEffect(() => {
    if (id) app.openSession(id)
  }, [id, app.openSession])

  // Load the per-message ratings for the active session.
  useEffect(() => {
    const current = app.sessionId
    if (!current) {
      setFeedback({})
      return
    }
    let active = true
    fetchFeedback(current)
      .then((value) => {
        if (active) setFeedback(value)
      })
      .catch(() => {
        if (active) setFeedback({})
      })
    return () => {
      active = false
    }
  }, [app.sessionId])

  // Keep the URL in sync with the active session (after the first message).
  useEffect(() => {
    if (!id && app.sessionId) navigate(`/${app.sessionId}`, { replace: true })
  }, [id, app.sessionId, navigate])

  // Refresh on conversation growth or backend-resolved capacity changes.
  useEffect(() => {
    if (!app.sessionId) {
      setContext(null)
      return
    }
    let cancelled = false
    fetchContext(app.sessionId)
      .then((usage) => {
        if (!cancelled) setContext({ used: usage.used, limit: usage.limit })
      })
      .catch(() => {
        if (!cancelled) setContext(null)
      })
    return () => {
      cancelled = true
    }
  }, [app.sessionId, app.messages.length, app.info?.modelId, app.info?.context.limit])

  async function onFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return
    if (files.length + attachments.length > 16) { toast.error(t('upload.limit')); return }
    try {
      const uploaded = await Promise.all(Array.from(files, (file) => uploadFile(file)))
      setAttachments((current) => [...current, ...uploaded])
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('upload.failed'))
    }
  }

  function pinToLatest(): void {
    followingRef.current = true
    setJumpVisible(false)
    setUnreadTail(false)
    requestAnimationFrame(() => {
      const viewport = scrollViewportRef.current
      if (viewport) viewport.scrollTop = viewport.scrollHeight
    })
  }

  function jumpToLatest(): void {
    followingRef.current = true
    setJumpVisible(false)
    setUnreadTail(false)
    const viewport = scrollViewportRef.current
    if (viewport) viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })
  }

  const submit = (): void => {
    const prompt = draft.trim()
    if (prompt.length === 0) return
    const queued = app.busy
    if (queued && (prompt === '/reload' || prompt === '/compact')) { toast.error(t('queue.commandBusy')); return }
    if (prompt === '/loop' || prompt.startsWith('/loop ')) {
      const args = prompt.slice('/loop'.length).trim()
      if (args.length === 0) { toast.error(t('loop.usage')); return }
      const paths = attachments.map((file) => file.path)
      setDraft('')
      setAttachments([])
      pinToLatest()
      app.send(prompt, paths, { args })
      return
    }
    if (prompt === '/reload') {
      setDraft('')
      reload()
        .then(() => {
          app.refreshInfo()
          toast.success(t('settings.reloadDone'))
        })
        .catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : String(cause)))
      return
    }
    if (prompt === '/compact') {
      setDraft('')
      if (!app.sessionId) {
        toast.error(t('compact.none'))
        return
      }
      compact(app.sessionId)
        .then((result) => {
          toast.success(result.compacted ? t('compact.done') : t('compact.none'))
          app.refreshInfo()
        })
        .catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : String(cause)))
      return
    }
    const paths = attachments.map((file) => file.path)
    setDraft('')
    setAttachments([])
    pinToLatest()
    app.send(prompt, paths)
    // Busy submissions wait in the same ordered queue as the composer's list.
    if (queued) toast.success(t('queue.added'))
  }

  function toggleUi(patch: { expandThinking?: boolean; expandTools?: boolean }): void {
    setUi(patch)
      .then(() => app.refreshInfo())
      .catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : String(cause)))
  }

  const showThinking = app.info?.expandThinking ?? false
  const showTools = app.info?.expandTools ?? false
  const toolActivity = useMemo(() => matchToolResults(app.messages), [app.messages])
  // Fork indexes count transcript messages only; system notices (compaction,
  // background job notifications) are not branching targets.
  const forkIndexes = useMemo(() => {
    let count = 0
    return app.messages.map(message => message.role === 'system' ? -1 : count++)
  }, [app.messages])

  async function branch(index: number): Promise<void> {
    const current = app.sessionId
    if (!current) return
    try {
      const { sessionId } = await forkSession(current, index)
      toast.success(t('message.branched'))
      navigate(`/${sessionId}`)
      void app.openSession(sessionId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  async function edit(index: number, content: string): Promise<boolean> {
    const current = app.sessionId
    if (!current) return false
    try {
      const { sessionId } = await forkSession(current, index, true)
      toast.success(t('message.edited'))
      app.sendTo(sessionId, content)
      navigate(`/${sessionId}`)
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  function rate(index: number, value: 'up' | 'down'): void {
    const current = app.sessionId
    if (!current) return
    const next = feedback[index] === value ? null : value
    setFeedback((previous) => {
      const copy = { ...previous }
      if (next) copy[index] = next
      else delete copy[index]
      return copy
    })
    void sendFeedback(current, index, next).catch((cause: unknown) =>
      toast.error(cause instanceof Error ? cause.message : String(cause)),
    )
  }
  const empty = app.messages.length === 0
  const landing = empty && view === 'chat'
  const shellJobs = app.jobs.filter(job => job.kind === 'shell')
  const runningJobs = shellJobs.filter(job => job.status === 'running').length
  const runningTasks = app.tasks.filter(task => task.status === 'running').length
  const workspaceLabel = app.info?.project?.name ?? app.info?.workspace?.split(/[\\/]/).filter(Boolean).at(-1) ?? t('workspace.title')
  const commandHints =
    draft.startsWith('/') && !draft.includes(' ') ? COMMANDS.filter((command) => command.name.startsWith(draft.slice(1))) : []

  return (
    <div className="chat-layout">
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Button size="sm" variant={view === 'chat' ? 'secondary' : 'ghost'} aria-pressed={view === 'chat'} className="shrink-0" onClick={() => setView('chat')}><MessageSquare />{t('trajectory.chat')}</Button>
        <Button size="sm" variant={view === 'trajectory' ? 'secondary' : 'ghost'} aria-pressed={view === 'trajectory'} className="shrink-0" onClick={() => setView('trajectory')}><Activity />{t('trajectory.title')}</Button>
        <Button size="sm" variant="ghost" className="shrink-0" onClick={() => openRightSidebar('files')}><ListTree />{t('workspace.title')}</Button>
        {app.tasks.length > 0 ? (
          <select
            aria-label={t('task.view')}
            className="ml-auto h-8 shrink-0 rounded-md border bg-background px-2 text-xs"
            value={taskView ?? ''}
            onChange={(event) => setTaskView(event.target.value || null)}
          >
            <option value="">{t('task.main')}</option>
            {app.tasks.map(task => (
              <option key={task.taskId} value={task.taskId}>
                {`${task.description} · ${t(`task.${task.status}`)}`.slice(0, 80)}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {taskView && app.sessionId ? (
        <TaskView key={`${app.sessionId}/${taskView}`} sessionId={app.sessionId} taskId={taskView} onBack={() => setTaskView(null)} />
      ) : view === 'trajectory' ? <TrajectoryView key={app.sessionId ?? 'new'} sessionId={app.sessionId} /> : !empty ? (
        <div ref={scrollRootRef} className="relative flex min-h-0 flex-1 flex-col">
          <ScrollArea data-chat-scroll className="min-h-0 flex-1">
        <div className="px-3 sm:px-4">
          <div className="chat-column flex min-w-0 flex-col gap-6 px-4 py-6 [overflow-wrap:anywhere]" data-chat-transcript>
            {app.messages.map((message, index) => message.role === 'system' || toolActivity.attached.has(index) ? null : (
              <MessageRow
                key={index}
                message={message}
                index={index}
                forkIndex={forkIndexes[index]}
                showThinking={showThinking}
                showTools={showTools}
                onBranch={branch}
                onEdit={edit}
                onFeedback={rate}
                feedback={feedback[index]}
                toolResults={toolActivity.results.get(index)}
                busy={app.busy}
              />
            ))}
            {app.partial ? <div aria-live="off" aria-label={t('stream.live')} className="min-w-0">
              {app.partial.reasoning ? <details open={showThinking} className="mb-3 rounded-lg border p-3"><summary className="cursor-pointer text-sm text-muted-foreground">{t('ui.showThinking')}</summary><div className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{app.partial.reasoning}</div></details> : null}
              <Markdown content={app.partial.content} />
            </div> : null}
            {app.busy ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="size-2 animate-pulse rounded-full bg-primary" />
                {t('message.working')}
              </div>
            ) : null}
          </div>
        </div>
          </ScrollArea>
          {jumpVisible ? (
            <Button
              size="icon"
              variant="outline"
              className="absolute right-3 bottom-3 z-10 rounded-full shadow-md"
              title={t('chat.jumpToLatest')}
              aria-label={unreadTail ? t('chat.unreadTail') : t('chat.jumpToLatest')}
              onClick={jumpToLatest}
            >
              <ArrowDown className="size-4" />
              {unreadTail ? <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary" aria-hidden="true" /> : null}
            </Button>
          ) : null}
        </div>
      ) : null}

      {taskView ? null : <div data-chat-composer-seat className={cn(landing
        ? 'flex min-h-0 flex-1 flex-col justify-center overflow-y-auto px-3 py-8 sm:px-4'
        : 'shrink-0 px-3 pt-2 pb-3 sm:px-4 sm:pb-4')}>
        <div className="chat-column">
        {landing ? <div className="mb-6 flex w-full flex-col gap-6">
          <div className="flex items-center justify-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground" aria-hidden="true"><BrandMark className="size-6" /></span>
            <LandingGreeting />
            <Badge variant="secondary" className="text-[10px]">RingKo</Badge>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" className="min-w-0 max-w-full text-muted-foreground" onClick={() => openRightSidebar('files')} title={app.info?.workspace}>
              <Folder className="shrink-0" /><span className="truncate">{workspaceLabel}</span>
            </Button>
            <ModePicker />
          </div>
        </div> : null}
        {app.loop ? (
          <div aria-live="off" className="mb-2 flex w-full items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-block size-2 animate-pulse rounded-full bg-primary" aria-hidden="true" />
            <span>{t('loop.running', { iteration: app.loop.iteration })}{app.loop.maxIterations > 0 ? ` / ${app.loop.maxIterations}` : ''}{app.loop.promise ? ` → ${app.loop.promise}` : ''}</span>
          </div>
        ) : null}
        <TodoPanel />
        <QuestionPanel />
        <QueuePanel key={app.sessionId ?? 'new'} />
        <div data-chat-composer className="w-full rounded-2xl border bg-card shadow-sm transition-all focus-within:ring-2 focus-within:ring-ring/40">
          {commandHints.length > 0 ? (
            <div className="flex flex-col gap-0.5 px-2 pt-2">
              {commandHints.map((command) => (
                <button
                  key={command.name}
                  type="button"
                  className="flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-accent"
                  onClick={() => setDraft(`/${command.name}`)}
                >
                  <span className="font-mono text-foreground">/{command.name}</span>
                  <span className="text-muted-foreground">{t(command.label)}</span>
                </button>
              ))}
            </div>
          ) : null}
          {attachments.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 px-3 pt-3">
              {attachments.map((file) => (
                <Badge key={file.path} variant="secondary" className="gap-1 rounded-full font-normal">
                  <Paperclip className="size-3" />
                  {file.name}
                  <button
                    type="button"
                    className="ml-0.5 rounded-full hover:text-foreground"
                    onClick={() => setAttachments((current) => current.filter((entry) => entry.path !== file.path))}
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          ) : null}
          <div className="flex min-w-0 items-end gap-2 px-2 py-2">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  submit()
                }
              }}
              rows={landing ? 2 : 1}
              aria-label={t('composer.placeholder')}
              aria-description={t('composer.hint')}
              placeholder={t('composer.placeholder')}
              className="max-h-40 min-h-11 min-w-0 flex-1 resize-none border-0 bg-transparent px-2 pt-2.5 shadow-none focus-visible:ring-0"
            />
            <div className="flex shrink-0 items-center gap-1.5 pb-0.5">
              {app.busy ? (
                <Button variant="outline" size="icon" className="rounded-full" onClick={app.stop} title={t('composer.stop')} aria-label={t('composer.stop')}>
                  <Square />
                </Button>
              ) : null}
              <Button
                size="icon"
                className="relative rounded-full"
                onClick={submit}
                disabled={draft.trim().length === 0}
                title={app.busy ? t('queue.add') : t('composer.send')}
                aria-label={app.busy ? t('queue.add') : t('composer.send')}
              >
                <ArrowUp />
                {app.busy && app.queue.length > 0 ? (
                  <span className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full bg-primary text-[10px] leading-none font-semibold text-primary-foreground">{app.queue.length}</span>
                ) : null}
              </Button>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto px-2 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <ModelPicker />
            <ThinkingPicker />
            {!landing ? <ModePicker /> : null}
            <AccessPicker />
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              title={t('ui.showThinking')}
              onClick={() => toggleUi({ expandThinking: !showThinking })}
            >
              <Brain className={showThinking ? 'size-3.5 text-primary' : 'size-3.5'} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              title={t('ui.showTools')}
              onClick={() => toggleUi({ expandTools: !showTools })}
            >
              <Wrench className={showTools ? 'size-3.5 text-primary' : 'size-3.5'} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              title={t('upload.attach')}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="size-3.5" />
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                void onFiles(event.target.files)
                event.target.value = ''
              }}
            />
          </div>
        </div>
        <ComposerStatus usage={app.usage} context={context ?? app.info?.context} model={app.model ?? app.info?.model} />
        {app.tasks.length > 0 || shellJobs.length > 0 ? (
          <div className="mt-1 flex flex-wrap items-center justify-center gap-2 text-[10px] text-muted-foreground">
            <Activity aria-hidden="true" className="size-3" />
            {app.tasks.length > 0 ? (
              <Button size="sm" variant="ghost" className="h-5 px-2 text-[10px]" onClick={() => openRightSidebar('tasks')}>{t('task.runningSummary', { running: runningTasks, total: app.tasks.length })}</Button>
            ) : null}
            {shellJobs.length > 0 ? (
              <Button size="sm" variant="ghost" className="h-5 px-2 text-[10px]" onClick={() => openRightSidebar('jobs')}>{t('job.runningSummary', { running: runningJobs, total: shellJobs.length })}</Button>
            ) : null}
          </div>
        ) : null}
        </div>
      </div>}
    </div>
  )
}
