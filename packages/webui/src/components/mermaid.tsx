import { useEffect, useId, useState } from 'react'
import { useTheme } from 'next-themes'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { mermaidId, mermaidTheme } from '@/lib/mermaid'

interface RenderState {
  key: string
  svg?: string
  failed: boolean
}

/**
 * Render a Mermaid diagram to inline SVG. The chart re-renders when its source
 * or the resolved theme changes; an invalid or unrunnable chart shows its
 * source with a short caption instead of an empty block.
 */
export function Mermaid({ chart }: { chart: string }) {
  const { t } = useI18n()
  const { resolvedTheme } = useTheme()
  const theme = mermaidTheme(resolvedTheme)
  const id = mermaidId(useId())
  const key = `${theme}\u0000${chart}`
  const [state, setState] = useState<RenderState>({ key: '', failed: false })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        // Loaded on demand so Mermaid stays out of the main bundle.
        const { default: mermaid } = await import('mermaid')
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme, fontFamily: 'inherit' })
        const { svg } = await mermaid.render(id, chart)
        if (!cancelled) setState({ key, svg, failed: false })
      } catch {
        if (!cancelled) setState({ key, failed: true })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [chart, id, key, theme])

  const current = state.key === key
  if (current && state.svg) {
    return (
      <figure className="my-3 min-w-0 overflow-x-auto rounded-md bg-muted/20 p-3">
        <div
          className={cn('flex min-w-0 justify-center [&_svg]:h-auto [&_svg]:max-w-full')}
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
      </figure>
    )
  }
  return (
    <figure className="my-2 min-w-0 overflow-x-auto rounded-md bg-muted/40 p-3">
      <pre className="font-mono text-xs whitespace-pre">{chart}</pre>
      <figcaption className="mt-1 text-[11px] text-muted-foreground">
        {current && state.failed ? t('mermaid.failed') : t('mermaid.rendering')}
      </figcaption>
    </figure>
  )
}
