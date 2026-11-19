import { expect, it } from 'bun:test'
import { normalizeModel, normalizeProviderFile, tokenDraft, type EditableModel } from '../src/lib/model-settings'
import { parseProviderFile } from '../src/lib/provider-file'

it('normalizes numeric drafts, clears automatic fields and preserves unrelated metadata', () => {
  const model = { id: 'alias', name: 'Name', contextWindow: '262144', maxInputTokens: '200000', maxOutputTokens: '8192', catalogId: 'fixture/capacity', vision: false, toolCalling: true, url: 'https://fixture.invalid' }
  expect(normalizeModel(model)).toEqual({ ...model, contextWindow: 262144, maxInputTokens: 200000, maxOutputTokens: 8192 })
  expect(normalizeModel({ ...model, contextWindow: '', maxInputTokens: ' ', maxOutputTokens: undefined, catalogId: '' })).toEqual({ id: 'alias', name: 'Name', vision: false, toolCalling: true, url: 'https://fixture.invalid' })
  expect(normalizeProviderFile({ model: 'Fixture/alias', providers: [{ name: 'Fixture', models: [model] }] }).providers?.[0]?.models?.[0]?.contextWindow).toBe(262144)
})

it('rejects invalid and overflowing token drafts without changing the editor state', () => {
  for (const value of ['-1', '0', '1.5', '1e6', 'NaN', '9007199254740992', true as never, null as never]) expect(() => tokenDraft(value)).toThrow()
  expect(tokenDraft('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER)
  const model: EditableModel = { id: 'model', name: 'Model', contextWindow: '100', maxOutputTokens: '101' }
  expect(() => normalizeModel(model)).toThrow()
  expect(model.maxOutputTokens).toBe('101')
  expect(() => normalizeModel({ ...model, maxOutputTokens: '10', maxInputTokens: '101' })).toThrow()
})

it('round-trips model limits through JSON without allowing malformed visual values', () => {
  const file = { providers: [{ name: 'Fixture', models: [{ id: 'model', name: 'Model', contextWindow: 262144, maxOutputTokens: 8192, vision: false }] }] }
  expect(parseProviderFile(JSON.stringify(file))).toEqual(file)
  for (const model of [{ id: 'model', contextWindow: true }, { id: '' }, { id: 'model', catalogId: 'invalid' }, { id: 'model', name: {} }]) expect(() => parseProviderFile(JSON.stringify({ providers: [{ name: 'Fixture', models: [model] }] }))).toThrow()
})

it('normalizes reasoning level overrides and rejects unusable rows', () => {
  expect(normalizeModel({ id: 'model', name: 'Model', reasoningEfforts: { low: ' minimal ', max: 'xhigh' } }))
    .toMatchObject({ reasoningEfforts: { low: 'minimal', max: 'xhigh' } })
  expect(normalizeModel({ id: 'model', reasoningEfforts: {} })).not.toHaveProperty('reasoningEfforts')
  for (const reasoningEfforts of [null, [], { low: '' }, { ' ': 'low' }, { low: '   ' }, { low: 'a' as never, ' low ': 'b' }]) {
    expect(() => normalizeModel({ id: 'model', reasoningEfforts: reasoningEfforts as never })).toThrow()
  }
})
