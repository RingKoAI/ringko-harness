import { describe, expect, it } from 'bun:test'
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_FILE_BYTES,
  extractDroppedFiles,
  extractPastedFiles,
  hasFileTransfer,
  normalizeIntakeFile,
  splitUploadBatches,
  validateIntakeFiles,
} from '../src/lib/attachment-intake'

describe('attachment-intake', () => {
  const fixedDate = new Date(2026, 10, 18, 2, 55, 9)

  it('extracts unnamed pasted screenshots with unique timestamped filenames', () => {
    const png = new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' })
    const webp = new File([new Uint8Array([1, 2, 3])], '', { type: 'image/webp' })
    const result = extractPastedFiles({
      types: ['Files'],
      items: [
        { kind: 'file', type: 'image/png', getAsFile: () => png },
        { kind: 'file', type: 'image/webp', getAsFile: () => webp },
      ],
    }, fixedDate)
    expect(result).toHaveLength(2)
    expect(result[0]?.name).toBe('pasted-image-20261118-025509-1.png')
    expect(result[1]?.name).toBe('pasted-image-20261118-025509-2.webp')
  })

  it('does not hijack rich-text pastes that carry a preview bitmap alongside text/plain + text/html', () => {
    const preview = new File([new Uint8Array([1, 2])], 'image.png', { type: 'image/png' })
    const result = extractPastedFiles({
      types: ['text/plain', 'text/html', 'Files'],
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => preview }],
      getData: format => (format === 'text/plain' ? 'Copied paragraph from Docs' : '<p>Copied</p>'),
    }, fixedDate)
    expect(result).toEqual([])
  })

  it('detects file drag transfers and rejects dropped directories while keeping real files', () => {
    expect(hasFileTransfer({ types: ['text/plain'] })).toBe(false)
    expect(hasFileTransfer({ types: ['Files'] })).toBe(true)

    const valid = new File(['hello'], 'notes.md', { type: 'text/markdown' })
    const dropped = extractDroppedFiles({
      types: ['Files'],
      items: [
        { kind: 'file', type: '', getAsFile: () => null, webkitGetAsEntry: () => ({ isDirectory: true, isFile: false }) },
        { kind: 'file', type: 'text/markdown', getAsFile: () => valid, webkitGetAsEntry: () => ({ isDirectory: false, isFile: true }) },
      ],
    }, fixedDate)
    expect(dropped.rejectedDirectories).toBe(1)
    expect(dropped.files.map(f => f.name)).toEqual(['notes.md'])
  })

  it('sanitizes unsafe filename characters, validates size/count caps, and splits oversized batches', () => {
    const cleaned = normalizeIntakeFile(new File(['a'], 'bad:name?.png', { type: 'image/png' }), 0, fixedDate)
    expect(cleaned.name).toBe('bad_name_.png')

    expect(validateIntakeFiles([cleaned], MAX_ATTACHMENTS_PER_MESSAGE)).toEqual({ ok: false, reason: 'limit' })
    const huge = new File([new Uint8Array(1)], 'huge.bin')
    Object.defineProperty(huge, 'size', { value: MAX_ATTACHMENT_FILE_BYTES + 1 })
    expect(validateIntakeFiles([huge], 0)).toEqual({ ok: false, reason: 'tooLarge', fileName: 'huge.bin' })

    const f1 = new File([new Uint8Array(60)], 'a.bin')
    const f2 = new File([new Uint8Array(60)], 'b.bin')
    const f3 = new File([new Uint8Array(30)], 'c.bin')
    const batches = splitUploadBatches([f1, f2, f3], 100)
    expect(batches.map(batch => batch.map(f => f.name))).toEqual([['a.bin'], ['b.bin', 'c.bin']])
  })
})
