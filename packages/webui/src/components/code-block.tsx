import { Check, Copy, WrapText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getSingletonHighlighter, type Highlighter } from 'shiki'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

// Languages loaded once; unknown languages fall back to plain text.
const LANGS = [
  'typescript', 'tsx', 'javascript', 'jsx', 'json', 'python', 'ruby', 'go', 'rust',
  'java', 'kotlin', 'c', 'cpp', 'csharp', 'php', 'swift', 'bash', 'shell', 'powershell',
  'markdown', 'yaml', 'toml', 'ini', 'sql', 'html', 'css', 'scss', 'xml', 'diff',
  'dockerfile', 'graphql', 'lua', 'perl', 'r', 'vue', 'svelte', 'zig',
]

let highlighterPromise: Promise<Highlighter> | null = null
function highlighter(): Promise<Highlighter> {
  highlighterPromise ??= getSingletonHighlighter({
    themes: ['github-light', 'github-dark'],
    langs: LANGS,
  })
  return highlighterPromise
}

export function CodeBlock({ code, lang, className }: { code: string; lang?: string; className?: string }) {
  const { t } = useI18n()
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [wrapped, setWrapped] = useState(false)

  useEffect(() => {
    let cancelled = false
    const requested = lang && lang.length > 0 ? lang.toLowerCase() : 'text'
    highlighter()
      .then((instance) => {
        const available = instance.getLoadedLanguages()
        const use = available.includes(requested) ? requested : 'text'
        const out = instance.codeToHtml(code, {
          lang: use,
          themes: { light: 'github-light', dark: 'github-dark' },
          defaultColor: false,
        })
        if (!cancelled) setHtml(out)
      })
      .catch(() => {
        if (!cancelled) setHtml(null)
      })
    return () => {
      cancelled = true
    }
  }, [code, lang])

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable
    }
  }

  return (
    <div className={cn('group relative my-3 overflow-hidden rounded-lg border', className)}>
      <div className="flex items-center justify-between border-b bg-muted/40 px-2 py-1">
        <span className="font-mono text-[10px] text-muted-foreground">{lang && lang.length > 0 ? lang : 'text'}</span>
        <div className="flex items-center gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            title={wrapped ? t('code.nowrap') : t('code.wrap')}
            onClick={() => setWrapped((value) => !value)}
          >
            <WrapText className="size-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="size-6" title={t('code.copy')} onClick={() => void copy()}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </Button>
        </div>
      </div>
      {html ? (
        <div
          className={cn('shiki-host overflow-x-auto text-xs [&_pre]:m-0 [&_pre]:bg-transparent [&_pre]:p-3', wrapped && '[&_pre]:whitespace-pre-wrap [&_pre]:break-words')}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className={cn('overflow-x-auto p-3 text-xs', wrapped && 'whitespace-pre-wrap break-words')}>
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
}
