import { expect, it } from 'bun:test'
import { parseProviderFile } from '../src/lib/provider-file'

it('parses a provider file and accepts a missing providers array', () => {
  expect(parseProviderFile('{"model":"a/b","providers":[{"name":"a"}]}')).toEqual({ model: 'a/b', providers: [{ name: 'a' }] })
  expect(parseProviderFile('{"model":"a/b"}')).toEqual({ model: 'a/b' })
})

it('rejects malformed provider JSON before it can overwrite the visual editor', () => {
  for (const text of ['not json', '[]', 'null', '"text"', '{"providers":{}}']) {
    expect(() => parseProviderFile(text)).toThrow()
  }
})
