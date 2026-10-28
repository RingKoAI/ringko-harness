import { cn } from '@/lib/utils'

/** App mark: an open ring, matching the favicon and inheriting the current text color. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('size-5', className)} aria-hidden="true" focusable="false">
      <circle
        cx="12"
        cy="12"
        r="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="59.69 3.14"
      />
    </svg>
  )
}
