import type { ProviderFile } from '@/api'

/** Parse the provider JSON editor. Throws when the shape cannot be saved. */
export function parseProviderFile(text: string): ProviderFile {
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Provider JSON must be an object.')
  const file = value as ProviderFile
  if (file.providers !== undefined && !Array.isArray(file.providers)) throw new TypeError('"providers" must be an array.')
  return file
}
