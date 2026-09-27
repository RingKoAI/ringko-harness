import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Mermaid } from '@/components/mermaid'
import { cn } from '@/lib/utils'

/** Markdown renderer with GitHub-flavored syntax and inline Mermaid diagrams. */
export function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div
      className={cn(
        'prose prose-sm dark:prose-invert max-w-none',
        'prose-pre:bg-muted/50 prose-pre:text-foreground prose-code:before:content-none prose-code:after:content-none',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className: codeClass, children, node, ...props }) {
            const language = /language-(\w+)/.exec(codeClass ?? '')?.[1]
            if (language === 'mermaid') return <Mermaid chart={String(children)} />
            return (
              <code className={codeClass} {...props}>
                {children}
              </code>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
