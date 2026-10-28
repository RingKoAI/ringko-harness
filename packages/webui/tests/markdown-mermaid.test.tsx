import { expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '../src/i18n'
import { Markdown } from '../src/components/markdown'

const fenced = (info: string, body: string) => `\`\`\`${info}\n${body}\n\`\`\``

it('routes mermaid fences to the diagram renderer instead of the code block', () => {
  const html = renderToStaticMarkup(
    <I18nProvider><Markdown content={fenced('mermaid', 'graph TD; A-->B')} /></I18nProvider>,
  )
  // Server rendering cannot run Mermaid, so the diagram preserves its source
  // and reports that it is still rendering.
  expect(html).toContain('graph TD')
  expect(html).toContain('<figure')
  expect(html).not.toContain('language-mermaid')
})

it('matches the mermaid info string case-insensitively', () => {
  const html = renderToStaticMarkup(
    <I18nProvider><Markdown content={fenced('Mermaid', 'sequenceDiagram\nA->>B: hi')} /></I18nProvider>,
  )
  expect(html).toContain('sequenceDiagram')
  expect(html).toContain('<figure')
})

it('leaves other languages to the code block renderer', () => {
  const html = renderToStaticMarkup(
    <I18nProvider><Markdown content={fenced('ts', 'const answer = 42')} /></I18nProvider>,
  )
  expect(html).not.toContain('<figure')
  expect(html).toContain('const answer = 42')
})
