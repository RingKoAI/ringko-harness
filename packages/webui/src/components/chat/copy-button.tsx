import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { writeClipboard } from '@/lib/clipboard'
import type { useI18n } from '@/i18n'

type Translate = ReturnType<typeof useI18n>['t']

const COPY_FEEDBACK_MS = 1000

/** Selection-based fallback for hosts that expose no async clipboard writer. */
function selectionCopy(text: string): boolean {
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  try {
    area.select()
    return document.execCommand?.('copy') === true
  } finally {
    document.body.removeChild(area)
  }
}

/**
 * Copy affordance for one message. Success chrome appears only after the write
 * resolves, repeated clicks are ignored while it is pending or showing success,
 * a rejected write keeps the neutral icon, and the success chrome reverts on a timer.
 */
export function CopyButton({ text, t }: { text: string; t: Translate }) {
  const [pending, setPending] = useState(false)
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  async function copy(): Promise<void> {
    if (pending || copied) return
    setPending(true)
    try {
      await writeClipboard(text, { clipboard: navigator.clipboard, fallback: selectionCopy })
    } catch {
      setPending(false)
      return
    }
    setPending(false)
    setCopied(true)
    timer.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS)
  }
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-6"
      title={copied ? t('message.copied') : t('message.copy')}
      aria-label={copied ? t('message.copied') : t('message.copy')}
      onClick={() => void copy()}
      disabled={pending || copied}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </Button>
  )
}
