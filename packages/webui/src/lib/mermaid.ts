export type MermaidTheme = 'default' | 'dark'

/** Map the application's resolved theme onto Mermaid's built-in themes. */
export function mermaidTheme(resolved: string | null | undefined): MermaidTheme {
  return resolved === 'dark' ? 'dark' : 'default'
}

/**
 * Mermaid writes a temporary element identified by the render id. React's
 * generated ids contain colons, so strip everything outside a CSS-safe set and
 * keep one stable id per mounted diagram.
 */
export function mermaidId(reactId: string): string {
  const safe = reactId.replace(/[^A-Za-z0-9_-]/g, '')
  return `mermaid-${safe || 'chart'}`
}
