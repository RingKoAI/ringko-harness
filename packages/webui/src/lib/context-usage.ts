const MIN_DISPLAY_PERCENT = 0.1

export function contextRatio(used: number, limit: number): number {
  return Number.isFinite(used) && used >= 0 && Number.isFinite(limit) && limit > 0 ? Math.min(1, used / limit) : 0
}

/** A nonzero context must not look empty on million-token models. */
export function contextPercent(used: number, limit: number, locale: string): string {
  const percent = contextRatio(used, limit) * 100
  const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  return percent > 0 && percent < MIN_DISPLAY_PERCENT ? `<${format.format(MIN_DISPLAY_PERCENT)}` : format.format(percent)
}
