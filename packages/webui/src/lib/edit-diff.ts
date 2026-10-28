export type DiffLineKind = 'context' | 'add' | 'remove'
export interface DiffLine { kind: DiffLineKind; text: string }
export interface LineDiff { lines: DiffLine[]; additions: number; deletions: number; truncated: boolean }

export const EDIT_DIFF_LIMITS = { maxLines: 240, context: 2 } as const

function splitLines(value: string): string[] {
  if (value.length === 0) return []
  return value.split('\n')
}

/**
 * Build a compact unified diff for one exact-string edit. The edit replaces a
 * contiguous span, so shared leading and trailing lines become context and the
 * remaining old/new lines are rendered as removals and additions.
 */
export function editDiff(input: unknown, limits: { maxLines?: number; context?: number } = {}): LineDiff | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const args = input as Record<string, unknown>
  if (typeof args.old_string !== 'string' || typeof args.new_string !== 'string') return undefined
  if (args.old_string === args.new_string) return undefined

  const oldLines = splitLines(args.old_string)
  const newLines = splitLines(args.new_string)
  let prefix = 0
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1
  let oldEnd = oldLines.length
  let newEnd = newLines.length
  while (oldEnd > prefix && newEnd > prefix && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd -= 1
    newEnd -= 1
  }

  const context = Math.max(0, limits.context ?? EDIT_DIFF_LIMITS.context)
  const maxLines = Math.max(1, limits.maxLines ?? EDIT_DIFF_LIMITS.maxLines)
  const before = oldLines.slice(Math.max(0, prefix - context), prefix)
  const removed = oldLines.slice(prefix, oldEnd)
  const added = newLines.slice(prefix, newEnd)
  const after = oldLines.slice(oldEnd, Math.min(oldLines.length, oldEnd + context))

  const all: DiffLine[] = [
    ...before.map(text => ({ kind: 'context' as const, text })),
    ...removed.map(text => ({ kind: 'remove' as const, text })),
    ...added.map(text => ({ kind: 'add' as const, text })),
    ...after.map(text => ({ kind: 'context' as const, text })),
  ]
  return {
    lines: all.slice(0, maxLines),
    additions: added.length,
    deletions: removed.length,
    truncated: all.length > maxLines,
  }
}
