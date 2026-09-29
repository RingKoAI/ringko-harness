import { expect, it } from 'bun:test'
import { greetingPeriod } from '../src/lib/greeting'

it('selects greetings at each local time boundary, including midnight', () => {
  const cases = [[0, 'evening'], [4, 'evening'], [5, 'morning'], [10, 'morning'], [11, 'noon'], [13, 'noon'], [14, 'afternoon'], [16, 'afternoon'], [17, 'dusk'], [18, 'dusk'], [19, 'evening'], [23, 'evening']] as const
  for (const [hour, expected] of cases) {
    expect(greetingPeriod(new Date(2026, 8, 28, hour))).toBe(expected)
  }
})
