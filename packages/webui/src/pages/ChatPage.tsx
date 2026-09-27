import { ArrowUp, Brain, Paperclip, Square, Terminal, User, Wrench, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { reload, uploadFile, type ServerMessage, type ToolCall, type UploadedFile } from '@/api'
import { AccessPicker } from '@/components/access-picker'
import { Markdown } from '@/components/markdown'
import { ModelPicker } from '@/components/model-picker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { useI18n, type MessageKey } from '@/i18n'
import { useApp } from '@/store'
import { cn } from '@/lib/utils'

const SUGGESTIONS: MessageKey[] = ['chat.suggest.1', 'chat.suggest.2', 'chat.suggest.3']
const COMMANDS: { name: string; label: MessageKey }[] = [{ name: 'reload', label: 'command.reload' }]

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

function ToolCallList({ calls, t }: { calls: readonly ToolCall[]; t: Translate }) {
  if (calls.length === 0) return null
  return (
    <div className="space-y-1">
      {calls.map((call) => (
        <details key={call.id} className="rounded-md border bg-muted/20">
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs">
            <Wrench className="size-3 shrink-0" />
            <span className="font-mono">{call.name}</span>
            <span className="text-muted-foreground">{t('message.arguments')}</span>
          </summary>
          <pre className="overflow-x-auto px-3 pb-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {JSON.stringify(call.arguments ?? {}, null, 2)}
          </pre>
        </details>
      ))}
    </div>
  )
}

function ToolResult({ message, t }: { message: ServerMessage; t: Translate }) {
  return (
    <details className="rounded-md border bg-muted/20">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs">
        <Terminal className="size-3 shrink-0" />
        <span className="font-mono">{message.name}</span>
        <span className="truncate text-muted-foreground">{toolSummary(t, message.name, message.content)}</span>
      </summary>
      <pre className="max-h-80 overflow-auto px-3 pb-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
        {message.content}
      </pre>
    </details>
  )
}

function MessageRow({ message }: { message: ServerMessage }) {
  const { t } = useI18n()
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
        {message.reasoning ? (
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
            <ToolResult message={message} t={t} />
          ) : isUser ? (
            <div className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</div>
          ) : (
            <Markdown content={message.content} />
          )
        ) : null}
        {message.toolCalls && message.toolCalls.length > 0 ? <ToolCallList calls={message.toolCalls} t={t} /> : null}
      </div>
    </div>
  )
}

export function ChatPage() {
  const { t } = useI18n()
  const app = useApp()
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<UploadedFile[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function onFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return
    try {
      const uploaded = await Promise.all(Array.from(files, (file) => uploadFile(file)))
      setAttachments((current) => [...current, ...uploaded])
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('upload.failed'))
    }
  }

  const submit = (): void => {
    const prompt = draft.trim()
    if (prompt.length === 0 || app.busy) return
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
    const paths = attachments.map((file) => file.path)
    setDraft('')
    setAttachments([])
    app.send(prompt, paths)
  }

  const empty = app.messages.length === 0
  const commandHints =
    draft.startsWith('/') && !draft.includes(' ') ? COMMANDS.filter((command) => command.name.startsWith(draft.slice(1))) : []

  return (
    <>
      <ScrollArea className="flex-1">
        {empty ? (
          <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-6 px-6 text-center">
            <div className="grid size-12 place-items-center rounded-2xl bg-primary text-lg font-semibold text-primary-foreground shadow-sm">
              R
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-semibold tracking-tight">{t('chat.emptyTitle')}</h2>
              <p className="text-sm text-muted-foreground">{t('message.empty')}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((key) => (
                <Button
                  key={key}
                  variant="outline"
                  size="sm"
                  className="rounded-full font-normal text-muted-foreground"
                  onClick={() => setDraft(t(key))}
                >
                  {t(key)}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
            {app.messages.map((message, index) => (
              <MessageRow key={index} message={message} />
            ))}
            {app.busy ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="size-2 animate-pulse rounded-full bg-primary" />
                {t('message.working')}
              </div>
            ) : null}
          </div>
        )}
      </ScrollArea>

      <div className="border-t bg-background/60 p-3 backdrop-blur sm:p-4">
        <div className="mx-auto max-w-3xl rounded-2xl border bg-card shadow-sm transition-all focus-within:ring-2 focus-within:ring-ring/40">
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
            rows={1}
            placeholder={t('composer.placeholder')}
            className="min-h-11 resize-none border-0 bg-transparent px-4 pt-3 shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center justify-between gap-2 px-2 pt-1 pb-2">
            <div className="flex min-w-0 items-center gap-1">
              <ModelPicker />
              <AccessPicker />
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
            {app.busy ? (
              <Button variant="outline" size="icon" className="rounded-full" onClick={app.stop} title={t('composer.stop')}>
                <Square />
              </Button>
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
        <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-muted-foreground">{t('composer.hint')}</p>
      </div>
    </>
  )
}
