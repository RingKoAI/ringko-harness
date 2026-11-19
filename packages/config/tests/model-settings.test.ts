import { expect, it } from 'bun:test'
import { parseModelDefinition } from '../src/model-settings.ts'

it('keeps a valid reasoning override map', () => {
  expect(parseModelDefinition({ id: 'model', reasoningEfforts: { low: 'minimal', max: 'xhigh' } }))
    .toMatchObject({ id: 'model', reasoningEfforts: { low: 'minimal', max: 'xhigh' } })
})

it('rejects unusable reasoning override entries', () => {
  for (const reasoningEfforts of [null, [], 'low', { low: '' }, { low: '   ' }, { '': 'low' }, { low: 3 }, { ['x'.repeat(33)]: 'low' }]) {
    expect(() => parseModelDefinition({ id: 'model', reasoningEfforts })).toThrow()
  }
})
