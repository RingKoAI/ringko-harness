import { expect, it } from 'bun:test'
import { writeClipboard } from '../src/lib/clipboard'

it('writes through the async clipboard and resolves only after it settles', async () => {
  const writes: string[] = []
  let settled = false
  await writeClipboard('hello', {
    clipboard: { writeText: async text => { await Promise.resolve(); writes.push(text); settled = true } },
    fallback: () => { throw new Error('fallback must not run') },
  })
  expect(writes).toEqual(['hello'])
  expect(settled).toBe(true)
})

it('propagates a rejected async write instead of claiming success through the fallback', async () => {
  let fallbackUsed = false
  await expect(writeClipboard('denied', {
    clipboard: { writeText: async () => { throw new Error('permission denied') } },
    fallback: () => { fallbackUsed = true; return true },
  })).rejects.toThrow('permission denied')
  expect(fallbackUsed).toBe(false)
})

it('falls back to the selection copy only when no async writer exists', async () => {
  const copied: string[] = []
  await writeClipboard('legacy', { clipboard: null, fallback: text => { copied.push(text); return true } })
  expect(copied).toEqual(['legacy'])
  await writeClipboard('missing', { clipboard: {}, fallback: text => { copied.push(text); return true } })
  expect(copied).toEqual(['legacy', 'missing'])
})

it('rejects when the fallback copy fails so the caller keeps the neutral icon', async () => {
  await expect(writeClipboard('blocked', { clipboard: undefined, fallback: () => false })).rejects.toThrow('rejected')
})
