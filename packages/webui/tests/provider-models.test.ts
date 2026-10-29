import { expect, it } from 'bun:test'
import { mergeDiscoveredModels, newModelCount } from '../src/lib/provider-models'

it('merges discovered models without overwriting edited names or duplicating ids', () => {
  const existing = [{ id: 'alpha', name: 'Alpha (edited)' }, { id: 'gamma', name: '' }]
  const discovered = [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }, { id: 'beta', name: 'Beta again' }]
  expect(mergeDiscoveredModels(existing, discovered)).toEqual([
    { id: 'alpha', name: 'Alpha (edited)' },
    { id: 'gamma', name: '' },
    { id: 'beta', name: 'Beta' },
  ])
  expect(newModelCount(existing, discovered)).toBe(1)
})

it('reports no additions when every id already exists or is empty', () => {
  const existing = [{ id: 'alpha' }]
  expect(mergeDiscoveredModels(existing, [{ id: 'alpha' }, { id: '' }])).toEqual([{ id: 'alpha', name: '' }])
  expect(newModelCount(existing, [{ id: 'alpha' }, { id: '' }])).toBe(0)
})
