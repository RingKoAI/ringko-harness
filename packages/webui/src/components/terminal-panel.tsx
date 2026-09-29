import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState } from 'react'
import { Play, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { createTerminal, disposeTerminal, terminalSocketUrl } from '@/api'
import { useI18n } from '@/i18n'
import { Button } from './ui/button'

type TerminalStatus = 'starting' | 'connected' | 'disconnected' | 'error'

export function TerminalPanel({ enabled }: { enabled: boolean }) {
  const { t } = useI18n()
  const hostRef = useRef<HTMLDivElement>(null)
  const [generation, setGeneration] = useState(0)
  const [status, setStatus] = useState<TerminalStatus>('starting')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!enabled) return
    const host = hostRef.current
    if (!host) return

    let disposed = false
    let terminalId: string | undefined
    let socket: WebSocket | undefined
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'Cascadia Mono, Consolas, monospace',
      fontSize: 12,
      theme: {
        background: '#0a0a0a',
        foreground: '#e4e4e7',
        cursor: '#e4e4e7',
        selectionBackground: '#3f3f46',
      },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host)

    const sendResize = (): void => {
      if (host.clientWidth <= 0 || host.clientHeight <= 0) return
      try {
        fit.fit()
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    }
    const resizeObserver = new ResizeObserver(sendResize)
    resizeObserver.observe(host)
    const inputSubscription = terminal.onData((data) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data }))
    })

    async function start(): Promise<void> {
      try {
        sendResize()
        const result = await createTerminal(terminal.cols, terminal.rows)
        terminalId = result.id
        if (disposed) {
          await disposeTerminal(result.id)
          return
        }
        socket = new WebSocket(terminalSocketUrl(result.id))
        socket.onopen = () => {
          if (disposed) return
          setStatus('connected')
          setError('')
          sendResize()
          terminal.focus()
        }
        socket.onmessage = (event: MessageEvent<string>) => {
          let message: { type?: unknown; data?: unknown; message?: unknown; exitCode?: unknown }
          try {
            message = JSON.parse(event.data) as typeof message
          } catch {
            setError(t('terminal.invalidData'))
            return
          }
          if (message.type === 'output' && typeof message.data === 'string') {
            terminal.write(message.data)
          } else if (message.type === 'exit') {
            setStatus('disconnected')
            terminal.write(`\r\n${t('terminal.exited', { code: String(message.exitCode ?? '?') })}\r\n`)
          } else if (message.type === 'error') {
            setError(typeof message.message === 'string' ? message.message : t('terminal.serverError'))
          }
        }
        socket.onerror = () => {
          if (!disposed) {
            setStatus('error')
            setError(t('terminal.connectionError'))
          }
        }
        socket.onclose = () => {
          if (!disposed) setStatus((current) => current === 'error' ? current : 'disconnected')
        }
      } catch (cause) {
        if (!disposed) {
          setStatus('error')
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      }
    }

    void start()
    return () => {
      disposed = true
      resizeObserver.disconnect()
      inputSubscription.dispose()
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'dispose' }))
        socket.close()
      } else if (terminalId) {
        void disposeTerminal(terminalId).catch((cause: unknown) => {
          toast.error(cause instanceof Error ? cause.message : String(cause))
        })
      }
      terminal.dispose()
    }
  }, [enabled, generation, t])

  const labels: Record<TerminalStatus, string> = {
    starting: t('terminal.starting'),
    connected: t('terminal.connected'),
    disconnected: t('terminal.disconnected'),
    error: t('terminal.error'),
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <span
          className={`size-2 rounded-full ${status === 'connected' ? 'bg-emerald-500' : status === 'error' ? 'bg-destructive' : 'bg-muted-foreground'}`}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" role="status">{labels[status]}</span>
        <Button
          size="icon-xs"
          variant="ghost"
          title={t('terminal.restart')}
          aria-label={t('terminal.restart')}
          onClick={() => {
            setError('')
            setStatus('starting')
            setGeneration((value) => value + 1)
          }}
        >
          {status === 'starting' ? <Play /> : <RotateCcw />}
        </Button>
      </div>
      {error ? <p className="shrink-0 border-b px-3 py-2 text-xs text-destructive" role="alert">{error}</p> : null}
      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden bg-[#0a0a0a] p-2" aria-label={t('rightSidebar.terminal')} />
    </section>
  )
}
