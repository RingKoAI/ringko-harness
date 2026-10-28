import { expect, it } from 'bun:test'
import { mermaidId, mermaidTheme } from '../src/lib/mermaid'

it('maps only the dark resolved theme onto Mermaid dark, defaulting everything else', () => {
  expect(mermaidTheme('dark')).toBe('dark')
  for (const value of ['light', 'system', undefined, null, '']) expect(mermaidTheme(value)).toBe('default')
})

it('turns React ids into stable CSS-safe Mermaid ids', () => {
  expect(mermaidId(':r0:')).toBe('mermaid-r0')
  expect(mermaidId(':r1a:')).toBe('mermaid-r1a')
  expect(mermaidId('__proto__')).toBe('mermaid-__proto__')
  expect(mermaidId(':')).toBe('mermaid-chart')
  expect(mermaidId(':r0:')).not.toContain(':')
})
