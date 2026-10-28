/** Minimal async clipboard surface; the browser exposes it as `navigator.clipboard`. */
export interface ClipboardWriter {
  writeText(text: string): Promise<void>
}

export interface ClipboardOptions {
  /** Async writer when available; a missing or rejecting writer is not success. */
  clipboard?: ClipboardWriter | null
  /** Synchronous selection-based copy used when the async writer is unavailable. */
  fallback: (text: string) => boolean
}

/**
 * Writes text to the clipboard and resolves only on a real write. A rejecting
 * async writer propagates its failure instead of silently reporting success;
 * the synchronous fallback is used only when no async writer exists.
 */
export async function writeClipboard(text: string, options: ClipboardOptions): Promise<void> {
  if (typeof options.clipboard?.writeText === 'function') {
    await options.clipboard.writeText(text)
    return
  }
  if (!options.fallback(text)) throw new Error('Clipboard write was rejected.')
}
