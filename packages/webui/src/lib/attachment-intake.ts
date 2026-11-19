export const MAX_ATTACHMENTS_PER_MESSAGE = 16
export const MAX_ATTACHMENT_FILE_BYTES = 20 * 1024 * 1024
export const MAX_UPLOAD_BATCH_BYTES = 28 * 1024 * 1024

const IMAGE_MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
}

const GENERIC_CLIPBOARD_NAMES = new Set(['', 'image', 'image.png', 'image.jpg', 'image.jpeg', 'image.webp', 'image.gif', 'blob'])

export interface ClipboardLike {
  readonly types?: ArrayLike<string>
  readonly items?: ArrayLike<{
    readonly kind: string
    readonly type: string
    getAsFile(): File | null
  }>
  readonly files?: ArrayLike<File>
  getData?(format: string): string
}

export interface DataTransferItemWithEntry {
  readonly kind: string
  readonly type: string
  getAsFile(): File | null
  webkitGetAsEntry?(): { readonly isDirectory: boolean; readonly isFile: boolean } | null
}

export interface DropDataTransferLike {
  readonly types?: ArrayLike<string>
  readonly items?: ArrayLike<DataTransferItemWithEntry>
  readonly files?: ArrayLike<File>
}

export type IntakeValidationResult =
  | { readonly ok: true; readonly files: File[] }
  | { readonly ok: false; readonly reason: 'limit' | 'tooLarge'; readonly fileName?: string }

function formatTimestamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

function extensionForMime(mimeType: string): string {
  const normalized = mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  return IMAGE_MIME_EXTENSIONS[normalized] ?? (normalized.startsWith('image/') ? 'png' : 'bin')
}

function sanitizeFileName(raw: string): string {
  let out = ''
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i)
    const ch = raw[i]!
    out += code <= 0x1f || '<>:"/\\|?*'.includes(ch) ? '_' : ch
  }
  return out.trim()
}

/** Normalize clipboard/dragged filenames so unnamed screenshots get unique, safe names. */
export function normalizeIntakeFile(file: File, index: number, now = new Date()): File {
  const rawName = sanitizeFileName(file.name ?? '')
  const lower = rawName.toLowerCase()
  if (!GENERIC_CLIPBOARD_NAMES.has(lower)) {
    return rawName === file.name ? file : new File([file], rawName, { type: file.type, lastModified: file.lastModified })
  }
  const ext = extensionForMime(file.type)
  const prefix = file.type.startsWith('image/') ? 'pasted-image' : 'pasted-file'
  const generated = `${prefix}-${formatTimestamp(now)}-${index + 1}.${ext}`
  return new File([file], generated, { type: file.type, lastModified: file.lastModified })
}

/** Whether a drag event carries external files rather than in-page text selection. */
export function hasFileTransfer(transfer: DropDataTransferLike | null | undefined): boolean {
  if (!transfer?.types) return false
  for (let i = 0; i < transfer.types.length; i += 1) {
    if (transfer.types[i] === 'Files') return true
  }
  return false
}

/**
 * Extract files from a clipboard paste event. Rich-text copies from editors/docs
 * often attach a preview bitmap alongside `text/plain` + `text/html`; keep native
 * text paste in that case instead of hijacking the paste as an image upload.
 */
export function extractPastedFiles(clipboard: ClipboardLike | null | undefined, now = new Date()): File[] {
  if (!clipboard) return []
  const types = clipboard.types ? Array.from(clipboard.types) : []
  const collected: File[] = []

  if (clipboard.items && clipboard.items.length > 0) {
    for (let i = 0; i < clipboard.items.length; i += 1) {
      const item = clipboard.items[i]
      if (item?.kind !== 'file') continue
      const file = item.getAsFile()
      if (file) collected.push(file)
    }
  } else if (clipboard.files && clipboard.files.length > 0) {
    for (let i = 0; i < clipboard.files.length; i += 1) {
      const file = clipboard.files[i]
      if (file) collected.push(file)
    }
  }

  if (collected.length === 0) return []

  const plainText = clipboard.getData?.('text/plain') ?? ''
  if (
    plainText.trim().length > 0 &&
    types.includes('text/html') &&
    collected.every(file => file.type.startsWith('image/'))
  ) {
    return []
  }

  return collected.map((file, index) => normalizeIntakeFile(file, index, now))
}

/** Extract dropped files while rejecting raw directory drops cleanly. */
export function extractDroppedFiles(
  transfer: DropDataTransferLike | null | undefined,
  now = new Date(),
): { files: File[]; rejectedDirectories: number } {
  if (!transfer) return { files: [], rejectedDirectories: 0 }
  const files: File[] = []
  let rejectedDirectories = 0

  if (transfer.items && transfer.items.length > 0) {
    for (let i = 0; i < transfer.items.length; i += 1) {
      const item = transfer.items[i]
      if (!item || item.kind !== 'file') continue
      const entry = item.webkitGetAsEntry?.()
      if (entry?.isDirectory) {
        rejectedDirectories += 1
        continue
      }
      const file = item.getAsFile()
      if (file) files.push(file)
    }
  } else if (transfer.files && transfer.files.length > 0) {
    for (let i = 0; i < transfer.files.length; i += 1) {
      const file = transfer.files[i]
      if (file) files.push(file)
    }
  }

  return {
    files: files.map((file, index) => normalizeIntakeFile(file, index, now)),
    rejectedDirectories,
  }
}

/** Validate total attachment count and per-file byte limits before network upload. */
export function validateIntakeFiles(files: readonly File[], existingCount: number): IntakeValidationResult {
  if (existingCount + files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return { ok: false, reason: 'limit' }
  }
  for (const file of files) {
    if (file.size > MAX_ATTACHMENT_FILE_BYTES) {
      return { ok: false, reason: 'tooLarge', fileName: file.name }
    }
  }
  return { ok: true, files: [...files] }
}

/** Group files into bounded multipart batches so concurrent request caps are never exceeded. */
export function splitUploadBatches(files: readonly File[], maxBatchBytes = MAX_UPLOAD_BATCH_BYTES): File[][] {
  const batches: File[][] = []
  let current: File[] = []
  let currentBytes = 0
  for (const file of files) {
    if (current.length > 0 && (current.length >= MAX_ATTACHMENTS_PER_MESSAGE || currentBytes + file.size > maxBatchBytes)) {
      batches.push(current)
      current = []
      currentBytes = 0
    }
    current.push(file)
    currentBytes += file.size
  }
  if (current.length > 0) batches.push(current)
  return batches
}
