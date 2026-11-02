import { expect, it } from 'bun:test'
import { requiresFullAccessConfirmation } from '../src/components/access-picker'

it('requires a second confirmation only when entering full access', () => {
  expect(requiresFullAccessConfirmation('approval', 'full')).toBe(true)
  expect(requiresFullAccessConfirmation('assist', 'full')).toBe(true)
  expect(requiresFullAccessConfirmation('full', 'full')).toBe(false)
  expect(requiresFullAccessConfirmation('approval', 'assist')).toBe(false)
  expect(requiresFullAccessConfirmation('full', 'approval')).toBe(false)
})
