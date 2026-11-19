import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { canQuickJump, quickJumpAnchorId, quickJumpDensity, resolveQuickJumpIndex, type QuickJumpItem } from '@/lib/quick-jump'

const VIEWPORT_SELECTOR = '[data-slot="scroll-area-viewport"]'
/** Distance below the viewport's top edge that counts as the reader's line. */
const READING_LINE_OFFSET = 24

/** Rail geometry per role: the tick colour and the dot that marks the active one. */
function roleStyles(role: QuickJumpItem['role']): { tick: string; dot: string } {
  if (role === 'user') return { tick: 'bg-primary/35 hover:bg-primary/60', dot: 'bg-primary' }
  if (role === 'assistant') return { tick: 'bg-foreground/25 hover:bg-foreground/50', dot: 'bg-foreground' }
  return { tick: 'bg-muted hover:bg-foreground/40', dot: 'bg-foreground/80' }
}

/**
 * Vertical rail of one tick per message, so a long transcript can be scanned and
 * jumped through without dragging the scrollbar. The active tick tracks the
 * message crossing the reading line as the transcript scrolls.
 */
export function QuickJump({ rootRef, items }: { rootRef: RefObject<HTMLDivElement | null>; items: readonly QuickJumpItem[] }) {
  const { t } = useI18n()
  const [activeIndex, setActiveIndex] = useState(0)
  const frame = useRef<number | null>(null)
  const available = canQuickJump(items.length)

  const resolve = useCallback((viewport: HTMLElement): number => {
    const line = viewport.getBoundingClientRect().top + READING_LINE_OFFSET
    const tops: { top: number }[] = []
    for (const item of items) {
      const anchor = document.getElementById(quickJumpAnchorId(item.id))
      if (!anchor) continue
      tops.push({ top: anchor.getBoundingClientRect().top })
    }
    return resolveQuickJumpIndex(tops, line)
  }, [items])

  useEffect(() => {
    if (!available) return
    const viewport = rootRef.current?.querySelector<HTMLElement>(VIEWPORT_SELECTOR)
    if (!viewport) return

    const update = (): void => {
      frame.current = null
      const next = resolve(viewport)
      setActiveIndex(previous => (previous === next ? previous : next))
    }
    const schedule = (): void => {
      if (frame.current !== null) return
      frame.current = window.requestAnimationFrame(update)
    }

    schedule()
    viewport.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      viewport.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame.current !== null) {
        window.cancelAnimationFrame(frame.current)
        frame.current = null
      }
    }
  }, [available, resolve, rootRef])

  const jump = (item: QuickJumpItem): void => {
    const anchor = document.getElementById(quickJumpAnchorId(item.id))
    anchor?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (!available) return null

  const roleLabel = (role: QuickJumpItem['role']): string =>
    role === 'user' ? t('chat.quickJumpUser') : role === 'assistant' ? t('chat.quickJumpAssistant') : t('chat.quickJumpMessage')
  const density = quickJumpDensity(items.length)

  return (
    <TooltipProvider delayDuration={150}>
      <div
        className="pointer-events-none absolute inset-y-0 z-20 hidden w-8 lg:block"
        data-quick-jump
        // Sit in the gutter just outside the message column instead of on the
        // viewport edge, and stay reachable when the window is narrow.
        style={{ right: 'max(0.5rem, calc((100% - var(--chat-card-width)) / 2 - 3rem))' }}
      >
        <div
          className="pointer-events-auto absolute top-1/2 right-0 flex -translate-y-1/2 flex-col items-start"
          style={{ gap: density.gap }}
        >
          {items.map((item, index) => {
            const isActive = index === activeIndex
            const styles = roleStyles(item.role)
            return (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="flex w-7 items-center gap-1 text-left"
                    style={{ height: density.bar }}
                    aria-label={t('chat.quickJumpAria', { index: index + 1, role: roleLabel(item.role) })}
                    aria-current={isActive ? 'true' : undefined}
                    onClick={() => jump(item)}
                  >
                    <span
                      className={cn('w-4 rounded-full transition-colors', styles.tick, isActive && 'bg-foreground/80')}
                      style={{ height: density.bar }}
                    />
                    <span className={cn('size-1.5 rounded-full transition-opacity duration-200', styles.dot, isActive ? 'animate-pulse opacity-100' : 'opacity-0')} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left" sideOffset={8} className="max-w-64 text-left">
                  <div className="space-y-0.5">
                    <div className="text-[11px] opacity-75">
                      {t('chat.quickJumpPosition', { index: index + 1, total: items.length, role: roleLabel(item.role) })}
                    </div>
                    <div className="whitespace-pre-wrap break-words">{item.preview?.trim() || t('chat.quickJumpNoPreview')}</div>
                  </div>
                </TooltipContent>
              </Tooltip>
            )
          })}
          <div className="mt-1 w-5 text-center text-[10px] text-muted-foreground/80 tabular-nums" data-quick-jump-counter>
            {activeIndex + 1}/{items.length}
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
