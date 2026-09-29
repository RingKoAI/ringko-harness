export type GreetingPeriod = 'morning' | 'noon' | 'afternoon' | 'dusk' | 'evening'

/** Use the browser's local clock and timezone. */
export function greetingPeriod(date = new Date()): GreetingPeriod {
  const hour = date.getHours()
  if (hour >= 5 && hour < 11) return 'morning'
  if (hour >= 11 && hour < 14) return 'noon'
  if (hour >= 14 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 19) return 'dusk'
  return 'evening'
}
