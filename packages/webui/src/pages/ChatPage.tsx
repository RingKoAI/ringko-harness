import { Activity, ArrowUp, Brain, Check, Copy, Folder, GitBranch, ListTree, MessageSquare, Paperclip, Square, Terminal, ThumbsDown, ThumbsUp, User, Wrench, X } from 'lucide-react'
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
  type ToolCall,
  type UploadedFile,
} from '@/api'
import { LandingGreeting } from '@/components/landing-greeting'
import { AccessPicker } from '@/components/access-picker'
import { QueuePanel } from '@/components/queue-panel'
import type { RightSidebarTab } from '@/components/right-sidebar'
import { ModePicker } from '@/components/mode-picker'
import { ContextRingLabeled } from '@/components/context-ring'
import { Markdown } from '@/components/markdown'
import { ModelPicker } from '@/components/model-picker'
import { ThinkingPicker } from '@/components/thinking-picker'
import { TodoPanel } from '@/components/todo-panel'
import { TaskPanel } from '@/components/task-panel'
import { JobPanel } from '@/components/job-panel'
import { QuestionPanel } from '@/components/question-panel'
import { ToolLogSheet } from '@/components/tool-log-sheet'
import { TrajectoryView } from '@/components/trajectory-view'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { useI18n, type MessageKey } from '@/i18n'
import { useApp } from '@/store'
import { cn } from '@/lib/utils'
import { matchToolResults, toolCallTarget } from '@/lib/tool-activity'

const COMMANDS: { name: string; label: MessageKey }[] = [
  { name: 'reload', label: 'command.reload' },
  { name: 'compact', label: 'command.compact' },
]

type Translate = ReturnType<typeof useI18n>['t']

/** One-line summary for a tool result; glob/grep collapse to their match count. */
function toolSummary(t: Translate, name: string | undefined, content: string): string {
  if (name === 'glob' || name === 'grep') {
    try {
      const parsed = JSON.parse(content) as { matches?: unknown[] }
      if (Array.isArray(parsed.matches)) {
        return t(name === 'glob' ? 'message.files' : 'message.matches', { count: parsed.matches.length })
      }
    } catch {
      // Not JSON; fall through to the first line.
    }
  }
  const first = content.split('\n')[0] ?? ''
  return first.length > 80 ? `${first.slice(0, 80)}…` : first
}

function ToolCallList({ calls, results, busy, showDetails, t }: { calls: readonly ToolCall[]; results?: ReadonlyMap<string, ServerMessage>; busy: boolean; showDetails: boolean; t: Translate }) {
  if (calls.length === 0) return null
  return (
    <div className="space-y-1">
      {calls.map((call) => {
        const result = results?.get(call.id)
        const status = result?.failed ? t('message.failed') : result ? t('message.completed') : busy ? t('message.working') : t('message.unknown')
        const target = toolCallTarget(call.arguments)
        const summary = result ? toolSummary(t, call.name, result.content) : ''
        const heading = <>
          <Wrench className="size-3 shrink-0" aria-hidden="true" />
          <span className="shrink-0 font-mono">{call.name}</span>
          {target && <span className="min-w-0 truncate text-muted-foreground" title={target}>{target}</span>}
          <span className={cn('ml-auto shrink-0', result?.failed ? 'text-destructive' : 'text-muted-foreground')}>{status}</span>
        </>
        return showDetails ? (
          <details key={call.id} className="rounded-md border bg-muted/20 text-xs">
            <summary className="flex min-w-0 cursor-pointer items-center gap-2 px-3 py-1.5">{heading}</summary>
            <div className="space-y-2 border-t px-3 py-2">
              <div className="text-muted-foreground">{t('message.arguments')}</div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono">{JSON.stringify(call.arguments ?? {}, null, 2)}</pre>
              <div className="text-muted-foreground">{t('message.output')}</div>
              <pre className={cn('max-h-80 overflow-auto whitespace-pre-wrap break-all font-mono', result?.failed && 'text-destructive')}>{result?.content ?? status}</pre>
            </div>
          </details>
        ) : (
          <div key={call.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border bg-muted/20 px-3 py-1.5 text-xs">
            {heading}
            {result && <span className={cn('w-full truncate pl-5', result.failed ? 'text-destructive' : 'text-muted-foreground')}>{summary}</span>}
          </div>
        )
      })}
    </div>
  )
}

function ToolResult({ message, t }: { message: ServerMessage; t: Translate }) {
  return (
    <details className={cn('rounded-md border bg-muted/20', message.failed && 'border-destructive/50')}>
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs">
        <Terminal className="size-3 shrink-0" />
        <span className="font-mono">{message.name}</span>
        <span className={cn('truncate', message.failed ? 'text-destructive' : 'text-muted-foreground')}>{message.failed ? `${t('message.failed')} · ` : ''}{toolSummary(t, message.name, message.content)}</span>
      </summary>
      <pre className="max-h-80 overflow-auto px-3 pb-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
        {message.content}
      </pre>
    </details>
  )
}

function MessageRow({
  message,
  index,
  showThinking,
  showTools,
  onBranch,
  onFeedback,
  feedback,
  toolResults,
  busy,
}: {
  message: ServerMessage
  index: number
  showThinking: boolean
  showTools: boolean
  onBranch: (index: number) => void
  onFeedback: (index: number, value: 'up' | 'down') => void
  feedback?: 'up' | 'down'
  toolResults?: ReadonlyMap<string, ServerMessage>
  busy: boolean
}) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const isUser = message.role === 'user'
  const isTool = message.role === 'tool'
  return (
    <div className="group flex gap-3.5">
      <div
        className={cn(
          'mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ring-1 ring-border',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
        )}
      >
        {isUser ? <User className="size-3.5" /> : isTool ? <Terminal className="size-3.5" /> : <Brain className="size-3.5" />}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="text-xs font-medium text-muted-foreground">
          {isUser ? t('message.you') : isTool ? t('message.tool', { name: message.name ?? '' }) : t('message.assistant')}
        </div>
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
            <div className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</div>
          ) : (
            <Markdown content={message.content} />
          )
        ) : null}
        {message.toolCalls && message.toolCalls.length > 0 ? <ToolCallList calls={message.toolCalls} results={toolResults} busy={busy} showDetails={showTools} t={t} /> : null}
        {!isTool ? (
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            {!isUser && message.content ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                title={copied ? t('message.copied') : t('message.copy')}
                onClick={() => {
                  void navigator.clipboard.writeText(message.content)
                  setCopied(true)
                  toast.success(t('message.copied'))
                  setTimeout(() => setCopied(false), 1500)
                }}
              >
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              </Button>
            ) : null}
            <Button variant="ghost" size="icon" className="size-6" title={t('message.branch')} onClick={() => onBranch(index)}>
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
  const [toolLogOpen, setToolLogOpen] = useState(false)
  const [view, setView] = useState<'chat' | 'trajectory'>('chat')
  const [feedback, setFeedback] = useState<Record<number, 'up' | 'down'>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  // Refresh the context-usage ring as the conversation grows.
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
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [app.sessionId, app.messages.length, app.info?.modelId])

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

  const submit = (): void => {
    const prompt = draft.trim()
    if (prompt.length === 0) return
    if (app.busy && (prompt === '/reload' || prompt === '/compact')) { toast.error(t('queue.commandBusy')); return }
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
    app.send(prompt, paths)
  }

  function toggleUi(patch: { expandThinking?: boolean; expandTools?: boolean }): void {
    setUi(patch)
      .then(() => app.refreshInfo())
      .catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : String(cause)))
  }

  const showThinking = app.info?.expandThinking ?? false
  const showTools = app.info?.expandTools ?? false
  const toolActivity = useMemo(() => matchToolResults(app.messages), [app.messages])

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
  const workspaceLabel = app.info?.project?.name ?? app.info?.workspace?.split(/[\\/]/).filter(Boolean).at(-1) ?? t('workspace.title')
  const commandHints =
    draft.startsWith('/') && !draft.includes(' ') ? COMMANDS.filter((command) => command.name.startsWith(draft.slice(1))) : []

  return (
    <>
      <div className="flex shrink-0 gap-1 border-b px-3 py-2">
        <Button size="sm" variant={view === 'chat' ? 'secondary' : 'ghost'} aria-pressed={view === 'chat'} onClick={() => setView('chat')}><MessageSquare />{t('trajectory.chat')}</Button>
        <Button size="sm" variant={view === 'trajectory' ? 'secondary' : 'ghost'} aria-pressed={view === 'trajectory'} onClick={() => setView('trajectory')}><Activity />{t('trajectory.title')}</Button>
        <Button size="sm" variant="ghost" onClick={() => openRightSidebar('files')}><ListTree />{t('workspace.title')}</Button>
      </div>
      {view === 'trajectory' ? <TrajectoryView key={app.sessionId ?? 'new'} sessionId={app.sessionId} /> : !empty ? <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
            {app.messages.map((message, index) => message.role === 'system' || toolActivity.attached.has(index) ? null : (
              <MessageRow
                key={index}
                message={message}
                index={index}
                showThinking={showThinking}
                showTools={showTools}
                onBranch={branch}
                onFeedback={rate}
                feedback={feedback[index]}
                toolResults={toolActivity.results.get(index)}
                busy={app.busy}
              />
            ))}
            <TaskPanel />
            <JobPanel />
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
      </ScrollArea> : null}

      <div className={cn(landing
        ? 'flex min-h-0 flex-1 flex-col justify-center overflow-y-auto px-4 py-8 sm:px-8'
        : 'shrink-0 border-t bg-background/60 p-3 backdrop-blur sm:p-4')}>
        {landing ? <div className="mx-auto mb-6 flex w-full max-w-[850px] flex-col gap-6">
          <div className="flex items-center justify-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-lg font-semibold text-primary-foreground" aria-hidden="true">R</span>
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
        <TodoPanel />
        <QuestionPanel />
        <QueuePanel key={app.sessionId ?? 'new'} />
        <div className={cn("mx-auto w-full rounded-2xl border bg-card shadow-sm transition-all focus-within:ring-2 focus-within:ring-ring/40", landing ? "max-w-[850px]" : "max-w-3xl")}>
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
            placeholder={t('composer.placeholder')}
            className="min-h-11 resize-none border-0 bg-transparent px-4 pt-3 shadow-none focus-visible:ring-0"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 px-2 pt-1 pb-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              {!landing ? <ModelPicker /> : null}
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
                title={t('toolLog.title')}
                aria-label={t('toolLog.title')}
                disabled={!app.sessionId}
                onClick={() => setToolLogOpen(true)}
              >
                <ListTree className="size-3.5" />
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
            <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
              {landing ? <ModelPicker /> : null}
              {(() => {
                const usage = context ?? app.info?.context
                return usage ? <ContextRingLabeled used={usage.used} limit={usage.limit} /> : null
              })()}
              {app.busy ? (
                <>
                <Button variant="outline" size="icon" className="rounded-full" onClick={app.stop} title={t('composer.stop')}>
                  <Square />
                </Button>
                <Button size="icon" className="rounded-full" onClick={submit} disabled={!draft.trim()} title={t('queue.add')} aria-label={t('queue.add')}><ArrowUp /></Button>
                </>
              ) : (
                <Button
                  size="icon"
                  className="rounded-full"
                  onClick={submit}
                  disabled={draft.trim().length === 0}
                  title={t('composer.send')}
                >
                  <ArrowUp />
                </Button>
              )}
            </div>
          </div>
        </div>
        {!landing ? <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-muted-foreground">{t('composer.hint')}</p> : null}
      </div>
      <ToolLogSheet open={toolLogOpen} onOpenChange={setToolLogOpen} sessionId={app.sessionId} busy={app.busy} />
    </>
  )
}
