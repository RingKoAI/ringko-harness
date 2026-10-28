import { expect, it } from 'bun:test'
import { EDIT_DIFF_LIMITS, editDiff } from '../src/lib/edit-diff'

it('renders a single replacement as removed and added lines with shared context', () => {
  const diff = editDiff({ path: 'a.ts', old_string: 'const a = 1\nconst b = 2\nkeep', new_string: 'const a = 1\nconst b = 3\nkeep' })
  expect(diff?.additions).toBe(1)
  expect(diff?.deletions).toBe(1)
  expect(diff?.truncated).toBe(false)
  expect(diff?.lines).toEqual([
    { kind: 'context', text: 'const a = 1' },
    { kind: 'remove', text: 'const b = 2' },
    { kind: 'add', text: 'const b = 3' },
    { kind: 'context', text: 'keep' },
  ])
})

it('handles pure insertions, pure deletions and multi-line blocks', () => {
  const insert = editDiff({ old_string: 'a\nc', new_string: 'a\nb\nc' })
  expect(insert).toMatchObject({ additions: 1, deletions: 0 })
  expect(insert?.lines.filter(line => line.kind === 'add')).toEqual([{ kind: 'add', text: 'b' }])

  const remove = editDiff({ old_string: 'a\nb\nc', new_string: 'a\nc' })
  expect(remove).toMatchObject({ additions: 0, deletions: 1 })
  expect(remove?.lines.filter(line => line.kind === 'remove')).toEqual([{ kind: 'remove', text: 'b' }])

  const block = editDiff({ old_string: 'x\ny', new_string: 'p\nq\nr' })
  expect(block).toMatchObject({ additions: 3, deletions: 2 })
})

it('ignores non-edit inputs and no-op replacements', () => {
  expect(editDiff({ path: 'a.ts' })).toBeUndefined()
  expect(editDiff(null)).toBeUndefined()
  expect(editDiff('text')).toBeUndefined()
  expect(editDiff({ old_string: 'same', new_string: 'same' })).toBeUndefined()
})

it('bounds long diffs and reports truncation', () => {
  const before = Array.from({ length: 500 }, (_, index) => `line ${index}`)
  const after = Array.from({ length: 500 }, (_, index) => `line ${index}`).map(line => line.replace('line', 'changed'))
  const diff = editDiff({ old_string: before.join('\n'), new_string: after.join('\n') })
  expect(diff?.truncated).toBe(true)
  expect(diff?.lines.length).toBe(EDIT_DIFF_LIMITS.maxLines)
  expect(diff?.additions).toBe(500)
  expect(diff?.deletions).toBe(500)
})
