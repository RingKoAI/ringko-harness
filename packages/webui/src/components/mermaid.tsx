import { useEffect, useState } from 'react'

/** Render a Mermaid diagram to inline SVG; falls back to the source on error. */
export function Mermaid({ chart }: { chart: string }) {
  const [svg, setSvg] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        // Loaded on demand so Mermaid stays out of the main bundle.
        const { default: mermaid } = await import('mermaid')
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
        })
        const id = `mermaid-${Math.random().toString(36).slice(2)}`
        const result = await mermaid.render(id, chart)
        if (!cancelled) setSvg(result.svg)
      } catch {
        if (!cancelled) setSvg('')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [chart])

  if (svg.length === 0) {
    return <pre className="my-2 overflow-x-auto rounded-md bg-muted/40 p-3 font-mono text-xs">{chart}</pre>
  }
  return <div className="my-3 flex justify-center overflow-x-auto rounded-md bg-muted/20 p-3" dangerouslySetInnerHTML={{ __html: svg }} />
}
