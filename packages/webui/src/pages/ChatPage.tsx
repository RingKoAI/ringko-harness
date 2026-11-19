import { Activity, ArrowDown, ArrowUp, Brain, CornerDownRight, Folder, GitBranch, ImagePlus, ListOrdered, ListTree, LoaderCircle, MessageSquare, Paperclip, Pencil, Square, Terminal, ThumbsDown, ThumbsUp, User, Wrench, X } from 'lucide-react'
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
  uploadFiles,
  type BusyEnterMode,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useChatScroll } from '@/hooks/use-chat-scroll'
import { useI18n, type MessageKey } from '@/i18n'
import { useApp } from '@/store'
import { cn } from '@/lib/utils'
import { toolTurns } from '@/lib/tool-activity'
import { isPendingSessionId } from '@/lib/conversations'
import { quickJumpAnchorId, quickJumpPreview, type QuickJumpItem } from '@/lib/quick-jump'
import { extractDroppedFiles, extractPastedFiles, hasFileTransfer, validateIntakeFiles } from '@/lib/attachment-intake'
import { CopyButton } from '@/components/chat/copy-button'
import { QuickJump } from '@/components/chat/quick-jump'
import { ToolCallList, TurnToolActivity, ToolResult, toolSummary } from '@/components/chat/tool-activity'
import { BrandMark } from '@/components/brand-mark'

const COMMANDS: { name: string; label: MessageKey }[] = [
  { name: 'reload', label: 'command.reload' },
  { name: 'compact', label: 'command.compact' },
  { name: 'loop', label: 'command.loop' },
]

/** Radix Select rejects empty item values, so "main session" travels as this sentinel. */
const TASK_VIEW_MAIN = '__main__'

function MessageRow({
  message,
  index,
  anchorId,
  forkIndex,
  showThinking,
  showTools,
  onBranch,
  onEdit,
  onFeedback,
  feedback,
  toolResults,
  busy,
  showCalls,
  toolBusy,
}: {
  message: ServerMessage
  index: number
  /** DOM id the quick-jump rail scrolls to, when this message is on it. */
  anchorId?: string
  forkIndex: number
  showThinking: boolean
  showTools: boolean
  onBranch: (index: number) => void
  onEdit: (index: number, content: string) => Promise<boolean>
  onFeedback: (index: number, value: 'up' | 'down') => void
  feedback?: 'up' | 'down'
  toolResults?: ReadonlyMap<string, ServerMessage>
  busy: boolean
  showCalls: boolean
  toolBusy: boolean
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
    <div className="group min-w-0 space-y-2" data-chat-message {...anchorId === undefined ? {} : { id: anchorId }}>
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
        {message.runStatus === 'cancelled' ? (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">{t('message.cancelled')}</span>
        ) : null}
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
        {showCalls && message.toolCalls && message.toolCalls.length > 0 ? <ToolCallList calls={message.toolCalls} results={toolResults} busy={toolBusy} showDetails={showTools} t={t} /> : null}
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
  const [uploadingCounts, setUploadingCounts] = useState<Record<string, number>>({})
  const [draggingFiles, setDraggingFiles] = useState(false)
  const dragDepthRef = useRef(0)
  const previewUrlsRef = useRef(new Set<string>())
  const attachmentKey = app.sessionId ?? 'new'
  const attachments = attachmentDrafts[attachmentKey] ?? []
  const uploadingCount = uploadingCounts[attachmentKey] ?? 0
  const setAttachments = (value: SetStateAction<UploadedFile[]>) => setAttachmentDrafts(previous => ({ ...previous, [attachmentKey]: typeof value === 'function' ? value(previous[attachmentKey] ?? []) : value }))

  useEffect(() => {
    const urls = previewUrlsRef.current
    return () => {
      for (const url of urls) URL.revokeObjectURL(url)
      urls.clear()
    }
  }, [])
  const [context, setContext] = useState<{ used: number; limit: number } | null>(null)
  const [view, setView] = useState<'chat' | 'trajectory'>('chat')
  const [taskView, setTaskView] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Record<number, 'up' | 'down'>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)
  const empty = app.messages.length === 0 && app.steering.length === 0
  // The scroll area only exists once the transcript is mounted, so the hook is
  // told when that happens instead of probing a ref that is still null.
  const transcriptMounted = !empty && view === 'chat' && !taskView
  const {
    rootRef: scrollRootRef,
    jumpVisible,
    unread: unreadTail,
    scrollToLatest,
    pinToLatest,
  } = useChatScroll({ active: transcriptMounted, resetKey: app.sessionId ?? null })

  // Load the session named by the URL (deep link / refresh).
  useEffect(() => {
    if (id && !isPendingSessionId(id)) app.openSession(id)
  }, [id, app.openSession])

  // Load the per-message ratings for the active session.
  useEffect(() => {
    const current = app.sessionId
    if (!current || isPendingSessionId(current)) {
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
    if (isPendingSessionId(id)) navigate(app.sessionId && !isPendingSessionId(app.sessionId) ? `/${app.sessionId}` : '/', { replace: true })
    else if (!id && app.sessionId && !isPendingSessionId(app.sessionId)) navigate(`/${app.sessionId}`, { replace: true })
  }, [id, app.sessionId, navigate])

  // Refresh on conversation growth or backend-resolved capacity changes.
  useEffect(() => {
    if (!app.sessionId || isPendingSessionId(app.sessionId)) {
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

  function releaseAttachmentPreview(url: string | undefined): void {
    if (!url) return
    URL.revokeObjectURL(url)
    previewUrlsRef.current.delete(url)
  }

  function clearCurrentAttachments(): void {
    for (const entry of attachments) releaseAttachmentPreview(entry.previewUrl)
    setAttachments([])
  }

  async function intakeFiles(rawFiles: readonly File[]): Promise<void> {
    if (rawFiles.length === 0) return
    const targetKey = attachmentKey
    const validation = validateIntakeFiles(rawFiles, attachments.length + uploadingCount)
    if (!validation.ok) {
      toast.error(validation.reason === 'limit' ? t('upload.limit') : t('upload.tooLarge', { name: validation.fileName ?? '' }))
      return
    }
    const batchCount = validation.files.length
    setUploadingCounts(previous => ({ ...previous, [targetKey]: (previous[targetKey] ?? 0) + batchCount }))
    const localPreviews = validation.files.map(file => {
      if (!file.type.startsWith('image/') || typeof URL.createObjectURL !== 'function') return undefined
      const url = URL.createObjectURL(file)
      previewUrlsRef.current.add(url)
      return url
    })
    try {
      const uploaded = await uploadFiles(validation.files)
      const enriched = uploaded.map((item, idx) => (localPreviews[idx] ? { ...item, previewUrl: localPreviews[idx] } : item))
      setAttachmentDrafts(previous => ({ ...previous, [targetKey]: [...(previous[targetKey] ?? []), ...enriched] }))
    } catch (cause) {
      for (const url of localPreviews) releaseAttachmentPreview(url)
      toast.error(cause instanceof Error ? cause.message : t('upload.failed'))
    } finally {
      setUploadingCounts(previous => {
        const next = Math.max(0, (previous[targetKey] ?? 0) - batchCount)
        return { ...previous, [targetKey]: next }
      })
    }
  }

  async function onFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return
    await intakeFiles(Array.from(files))
  }

  const busyEnter: BusyEnterMode = app.info?.busyEnter === 'steer' ? 'steer' : 'queue'

  const submit = (modeOverride?: BusyEnterMode): void => {
    if (uploadingCount > 0) {
      toast.error(t('upload.wait'))
      return
    }
    const rawPrompt = draft.trim()
    const prompt = rawPrompt || (attachments.length > 0 ? t('upload.defaultPrompt') : '')
    if (prompt.length === 0) return
    const busy = app.busy
    if (busy && (prompt === '/reload' || prompt === '/compact')) { toast.error(t('queue.commandBusy')); return }
    if (prompt === '/loop' || prompt.startsWith('/loop ')) {
      const args = prompt.slice('/loop'.length).trim()
      if (args.length === 0) { toast.error(t('loop.usage')); return }
      const paths = attachments.map((file) => file.path)
      if (app.send(prompt, paths, { args })) { clearCurrentAttachments(); pinToLatest() }
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
      if (!app.sessionId || isPendingSessionId(app.sessionId)) {
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
    const deliveryMode: BusyEnterMode = modeOverride ?? busyEnter
    if (busy && deliveryMode === 'steer') {
      if (!app.steer(prompt, paths)) return
      clearCurrentAttachments()
      pinToLatest()
      toast.success(t('steer.added'))
      return
    }
    if (!app.send(prompt, paths)) return
    clearCurrentAttachments()
    pinToLatest()
    // Busy submissions wait in the same ordered queue as the composer's list.
    if (busy) toast.success(t('queue.added'))
  }

  function toggleUi(patch: { expandThinking?: boolean; expandTools?: boolean }): void {
    setUi(patch)
      .then(() => app.refreshInfo())
      .catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : String(cause)))
  }

  const showThinking = app.info?.expandThinking ?? false
  const showTools = app.info?.expandTools ?? false
  const toolActivity = useMemo(() => toolTurns(app.messages, app.busy, app.error), [app.messages, app.busy, app.error])
  // Fork indexes count transcript messages only; system notices (compaction,
  // background job notifications) are not branching targets.
  const forkIndexes = useMemo(() => {
    let count = 0
    return app.messages.map(message => message.role === 'system' ? -1 : count++)
  }, [app.messages])

  // One rail tick per conversational message; system notices and tool traffic
  // stay out so the rail mirrors what the reader wrote and what answered.
  const quickJumpItems = useMemo<QuickJumpItem[]>(() => app.messages.flatMap((message, index) => {
    if (message.role !== 'user' && message.role !== 'assistant') return []
    const preview = quickJumpPreview(message.content.length > 0 ? message.content : message.reasoning ?? '')
    return [{ id: String(index), role: message.role, ...(preview.length === 0 ? {} : { preview }) }]
  }), [app.messages])
  const quickJumpIndexes = useMemo(() => new Set(quickJumpItems.map(item => item.id)), [quickJumpItems])

  async function branch(index: number): Promise<void> {
    const current = app.sessionId
    if (!current || isPendingSessionId(current)) return
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
    if (!current || isPendingSessionId(current)) return false
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
    if (!current || isPendingSessionId(current)) return
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
  function renderMessage(index: number, showCalls: boolean, toolBusy: boolean) {
    const message = app.messages[index]!
    if (message.role === 'system' || toolActivity.attached.has(index) || (message.role === 'tool' && !showCalls)) return null
    if (message.role === 'assistant' && !message.content && (!message.reasoning || !showThinking) && !showCalls) return null
    return <MessageRow key={index} message={message} index={index} forkIndex={forkIndexes[index]} showThinking={showThinking} showTools={showTools}
      {...quickJumpIndexes.has(String(index)) ? { anchorId: quickJumpAnchorId(String(index)) } : {}}
      onBranch={branch} onEdit={edit} onFeedback={rate} feedback={feedback[index]} toolResults={toolActivity.results.get(index)} busy={app.busy || isPendingSessionId(app.sessionId)} showCalls={showCalls} toolBusy={toolBusy} />
  }
  const hasSubmittableContent = draft.trim().length > 0 || attachments.length > 0
  const plainDraft = hasSubmittableContent && !draft.trimStart().startsWith('/')
  const canSteerQueue = app.busy && !hasSubmittableContent && app.queue.some(item => !item.loop) && !isPendingSessionId(app.sessionId)
  const landing = empty && view === 'chat'
  const shellJobs = app.jobs.filter(job => job.kind === 'shell')
  const runningJobs = shellJobs.filter(job => job.status === 'running').length
  const runningTasks = app.tasks.filter(task => task.status === 'running').length
  const workspaceLabel = app.info?.project?.name ?? app.info?.workspace?.split(/[\\/]/).filter(Boolean).at(-1) ?? t('workspace.title')
  const commandHints =
    draft.startsWith('/') && !draft.includes(' ') ? COMMANDS.filter((command) => command.name.startsWith(draft.slice(1))) : []

  return (
    <div
      className="chat-layout relative"
      onDragEnter={(event) => {
        if (taskView || !hasFileTransfer(event.dataTransfer)) return
        event.preventDefault()
        dragDepthRef.current += 1
        setDraggingFiles(true)
      }}
      onDragOver={(event) => {
        if (taskView || !hasFileTransfer(event.dataTransfer)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(event) => {
        if (!hasFileTransfer(event.dataTransfer)) return
        event.preventDefault()
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
        if (dragDepthRef.current === 0) setDraggingFiles(false)
      }}
      onDrop={(event) => {
        if (taskView || !hasFileTransfer(event.dataTransfer)) return
        event.preventDefault()
        dragDepthRef.current = 0
        setDraggingFiles(false)
        const { files, rejectedDirectories } = extractDroppedFiles(event.dataTransfer)
        if (rejectedDirectories > 0) toast.error(t('upload.directoryUnsupported'))
        if (files.length > 0) void intakeFiles(files)
      }}
    >
      {draggingFiles ? (
        <div
          data-drop-overlay
          className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary bg-background/90 backdrop-blur-xs"
        >
          <ImagePlus className="size-8 text-primary" aria-hidden="true" />
          <p className="text-sm font-medium">{t('upload.dropTitle')}</p>
          <p className="text-xs text-muted-foreground">{t('upload.dropHint')}</p>
        </div>
      ) : null}
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Button size="sm" variant={view === 'chat' ? 'secondary' : 'ghost'} aria-pressed={view === 'chat'} className="shrink-0" onClick={() => setView('chat')}><MessageSquare />{t('trajectory.chat')}</Button>
        <Button size="sm" variant={view === 'trajectory' ? 'secondary' : 'ghost'} aria-pressed={view === 'trajectory'} className="shrink-0" onClick={() => setView('trajectory')}><Activity />{t('trajectory.title')}</Button>
        <Button size="sm" variant="ghost" className="shrink-0" onClick={() => openRightSidebar('files')}><ListTree />{t('workspace.title')}</Button>
        {app.tasks.length > 0 ? (
          <Select
            value={taskView ?? TASK_VIEW_MAIN}
            onValueChange={value => setTaskView(value === TASK_VIEW_MAIN ? null : value)}
          >
            <SelectTrigger aria-label={t('task.view')} className="ml-auto h-8 shrink-0 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TASK_VIEW_MAIN}>{t('task.main')}</SelectItem>
              {app.tasks.map(task => (
                <SelectItem key={task.taskId} value={task.taskId}>
                  {`${task.description} · ${t(`task.${task.status}`)}`.slice(0, 80)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
      {taskView && app.sessionId && !isPendingSessionId(app.sessionId) ? (
        <TaskView key={`${app.sessionId}/${taskView}`} sessionId={app.sessionId} taskId={taskView} onBack={() => setTaskView(null)} />
      ) : view === 'trajectory' ? <TrajectoryView key={app.sessionId ?? 'new'} sessionId={isPendingSessionId(app.sessionId) ? undefined : app.sessionId} /> : !empty ? (
        <div ref={scrollRootRef} className="relative flex min-h-0 flex-1 flex-col">
          <ScrollArea data-chat-scroll className="min-h-0 flex-1">
        <div className="px-3 sm:px-4">
          <div className="chat-column flex min-w-0 flex-col gap-6 px-4 py-6 [overflow-wrap:anywhere]" data-chat-transcript>
            {toolActivity.turns.map(turn => app.messages.slice(turn.start, turn.end).every(message => message.role === 'system') ? null : (
              <div key={`${app.sessionId ?? 'new'}:${turn.key}`} className="min-w-0 space-y-6" data-chat-turn>
                {turn.userIndex === undefined ? null : renderMessage(turn.userIndex, true, turn.running)}
                <TurnToolActivity turn={turn} showDetails={showTools} override={app.toolExpansions[turn.key]} onToggle={open => app.setToolExpansion(turn.key, showTools, open)} t={t}>
                  {open => Array.from({ length: turn.end - turn.start }, (_, offset) => turn.start + offset).map(index => index === turn.userIndex ? null : renderMessage(index, open, turn.running))}
                </TurnToolActivity>
              </div>
            ))}
            {app.partial ? <div aria-live="off" aria-label={t('stream.live')} className="min-w-0">
              {app.partial.reasoning ? <details open={showThinking} className="mb-3 rounded-lg border p-3"><summary className="cursor-pointer text-sm text-muted-foreground">{t('ui.showThinking')}</summary><div className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{app.partial.reasoning}</div></details> : null}
              <Markdown content={app.partial.content} />
              {app.partial.toolInputs?.map(call => <details key={call.id} open={showTools} className="mt-2 min-w-0 rounded-lg border p-3">
                <summary className="cursor-pointer break-words text-sm"><span className="font-medium">{call.name}</span><span className="ml-2 text-muted-foreground">{t(call.complete ? 'stream.toolReady' : 'stream.toolGenerating')}</span></summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">{call.text}</pre>
                {call.truncated ? <p className="mt-1 text-xs text-muted-foreground">{t('stream.toolTruncated')}</p> : null}
              </details>)}
            </div> : null}
            {app.steering.map(item => (
              <div key={item.id} data-pending-steering className="min-w-0 space-y-2 opacity-90">
                <div className="flex items-center gap-2">
                  <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground ring-1 ring-border">
                    <User className="size-3.5" />
                  </div>
                  <div className="text-xs font-medium text-muted-foreground">{t('message.you')}</div>
                  <Badge variant="outline" className="gap-1 text-[10px] font-normal">
                    <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-hidden="true" />
                    {t('steer.pending')}
                  </Badge>
                </div>
                <div className="text-sm leading-relaxed whitespace-pre-wrap">{item.content}</div>
              </div>
            ))}
            {app.busy ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="size-2 animate-pulse rounded-full bg-primary" />
                {t('message.working')}
              </div>
            ) : null}
          </div>
        </div>
          </ScrollArea>
          <QuickJump rootRef={scrollRootRef} items={quickJumpItems} />
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
        <div data-chat-composer className="relative w-full rounded-2xl border bg-card shadow-sm transition-all focus-within:ring-2 focus-within:ring-ring/40">
          {/* The jump control floats just above the input box and shares its
              right edge, so it never sits against the viewport border. */}
          {jumpVisible ? (
            <Button
              size="icon"
              variant="outline"
              className="absolute -top-11 right-2 z-10 rounded-full shadow-md"
              title={t('chat.jumpToLatest')}
              aria-label={unreadTail ? t('chat.unreadTail') : t('chat.jumpToLatest')}
              onClick={scrollToLatest}
            >
              <ArrowDown className="size-4" />
              {unreadTail ? <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary" aria-hidden="true" /> : null}
            </Button>
          ) : null}
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
          {attachments.length > 0 || uploadingCount > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 px-3 pt-3">
              {attachments.map((file) => (
                <Badge key={file.path} variant="secondary" className="gap-1.5 rounded-xl py-1 pr-1.5 pl-1.5 font-normal">
                  {file.previewUrl ? (
                    <img
                      src={file.previewUrl}
                      alt={file.name}
                      className="size-6 shrink-0 rounded object-cover ring-1 ring-border"
                    />
                  ) : (
                    <Paperclip className="size-3 shrink-0" />
                  )}
                  <span className="max-w-44 truncate">{file.name}</span>
                  <button
                    type="button"
                    className="ml-0.5 rounded-full hover:text-foreground"
                    onClick={() => {
                      releaseAttachmentPreview(file.previewUrl)
                      setAttachments((current) => current.filter((entry) => entry.path !== file.path))
                    }}
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
              {uploadingCount > 0 ? (
                <Badge variant="outline" className="gap-1 rounded-full font-normal text-muted-foreground">
                  <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
                  {t('upload.uploading', { count: uploadingCount })}
                </Badge>
              ) : null}
            </div>
          ) : null}
          <div className="flex min-w-0 items-end gap-2 px-2 py-2">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onPaste={(event) => {
                const pasted = extractPastedFiles(event.clipboardData)
                if (pasted.length > 0) {
                  event.preventDefault()
                  void intakeFiles(pasted)
                }
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return
                if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
                  if (event.ctrlKey || event.metaKey) {
                    event.preventDefault()
                    if (canSteerQueue) {
                      void app.steerAllQueued().then(count => { if (count > 0) pinToLatest() })
                    } else if (app.busy) {
                      submit(busyEnter === 'steer' ? 'queue' : 'steer')
                    } else {
                      submit()
                    }
                    return
                  }
                  event.preventDefault()
                  submit()
                }
              }}
              rows={landing ? 2 : 1}
              aria-label={t('composer.placeholder')}
              aria-description={t('composer.hint')}
              placeholder={canSteerQueue ? t('queue.steerAllHint') : t('composer.placeholder')}
              className="max-h-40 min-h-11 min-w-0 flex-1 resize-none border-0 bg-transparent px-2 pt-2.5 shadow-none focus-visible:ring-0"
            />
            <div className="flex shrink-0 items-center gap-1.5 pb-0.5">
              {app.busy ? (
                <Button variant="outline" size="icon" className="rounded-full" onClick={app.stop} title={t('composer.stop')} aria-label={t('composer.stop')}>
                  <Square />
                </Button>
              ) : null}
              {app.busy && plainDraft ? (
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-full"
                  disabled={uploadingCount > 0}
                  onClick={() => submit(busyEnter === 'steer' ? 'queue' : 'steer')}
                  title={busyEnter === 'steer' ? t('queue.add') : t('steer.sendHint')}
                  aria-label={busyEnter === 'steer' ? t('queue.add') : t('steer.send')}
                >
                  {busyEnter === 'steer' ? <ListOrdered /> : <CornerDownRight />}
                </Button>
              ) : null}
              <Button
                size="icon"
                className="relative rounded-full"
                onClick={() => submit()}
                disabled={!hasSubmittableContent || uploadingCount > 0}
                title={app.busy ? (busyEnter === 'steer' && plainDraft ? t('steer.send') : t('queue.add')) : t('composer.send')}
                aria-label={app.busy ? (busyEnter === 'steer' && plainDraft ? t('steer.send') : t('queue.add')) : t('composer.send')}
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
