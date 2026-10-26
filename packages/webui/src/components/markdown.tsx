import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from '@/components/code-block'
import { Mermaid } from '@/components/mermaid'
import { cn } from '@/lib/utils'
import { MarkdownListItem, MarkdownTaskInput } from '@/components/markdown-task-list'

/** Markdown renderer with GitHub-flavored syntax, highlighted code, and Mermaid. */
export function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div
      className={cn(
        'markdown-content prose prose-sm dark:prose-invert max-w-none',
        'prose-pre:bg-muted/50 prose-pre:text-foreground prose-code:before:content-none prose-code:after:content-none',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          li: MarkdownListItem,
          input: MarkdownTaskInput,
          pre({ children }) {
            const child = (Array.isArray(children) ? children[0] : children) as
              | { props?: { className?: string; children?: unknown } }
              | undefined
            const codeClass = child?.props?.className ?? ''
            const language = /language-([\w-]+)/.exec(codeClass)?.[1]
            if (language) {
              const code = String(child?.props?.children ?? '')
              if (language === 'mermaid') return <Mermaid chart={code} />
              return <CodeBlock code={code} lang={language} />
            }
            return <pre>{children}</pre>
          },
          code({ className: codeClass, children, node: _node, ...props }) {
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
