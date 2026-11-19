import { describe, expect, it } from 'bun:test'
import type { ProviderCredentialStatus, ProviderPreset } from '../src/api'
import {
  activeModelShortId,
  activeProviderName,
  buildQuickActivatedProvider,
  cloneProvider,
  countEnteredKeys,
  dedupeProviderName,
  filterPresets,
  filterProviderIndices,
  hasCustomModelLimits,
  parseSingleProviderJson,
  resolveEndpointPreview,
  reorderProviders,
  serializeSingleProviderJson,
  unconfiguredBuiltinPresets,
} from '../src/lib/provider-workbench'

describe('provider-workbench helpers', () => {
  it('resolves active provider and model IDs from <provider>/<model>', () => {
    expect(activeProviderName('deepseek/deepseek-chat')).toBe('deepseek')
    expect(activeProviderName('openrouter/anthropic/claude-sonnet-4')).toBe('openrouter')
    expect(activeProviderName('')).toBeNull()
    expect(activeProviderName('malformed')).toBeNull()

    expect(activeModelShortId('openrouter/anthropic/claude-sonnet-4', 'openrouter')).toBe('anthropic/claude-sonnet-4')
    expect(activeModelShortId('deepseek/deepseek-chat', 'openai')).toBeNull()
  })

  it('deduplicates provider names and clones providers cleanly without mutating originals or leaking inline keys', () => {
    expect(dedupeProviderName('deepseek', ['openai', 'anthropic'])).toBe('deepseek')
    expect(dedupeProviderName('deepseek', ['deepseek', 'deepseek-2'])).toBe('deepseek-3')

    const original = {
      name: 'openai',
      presetId: 'openai',
      type: 'openai',
      apiKey: 'sk-should-not-clone',
      baseURL: 'https://api.openai.com/v1',
      models: [{ id: 'gpt-5', name: 'GPT-5', contextWindow: 400_000 }],
    }
    const copy = cloneProvider(original, ['openai', 'openai-copy'])
    expect(copy.name).toBe('openai-copy-2')
    expect(copy.presetId).toBe('openai')
    expect(copy.apiKey).toBeUndefined()
    expect(copy.models?.[0]?.id).toBe('gpt-5')
    copy.models![0]!.name = 'Changed'
    expect(original.models[0]!.name).toBe('GPT-5')
  })

  it('filters providers, orders env-ready built-in presets first, and builds quick-activated providers', () => {
    const builtins: ProviderPreset[] = [
      { id: 'openai', label: 'OpenAI', type: 'openai', defaultModels: [{ id: 'gpt-5', name: 'GPT-5' }] },
      { id: 'deepseek', label: 'DeepSeek', type: 'openai-compatible', baseURL: 'https://api.deepseek.com/v1', defaultModels: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] },
      { id: 'ollama', label: 'Ollama', type: 'openai-compatible', baseURL: 'http://127.0.0.1:11434/v1', defaultModels: [{ id: 'qwen3:8b', name: 'Qwen3' }] },
    ]
    const creds: Record<string, ProviderCredentialStatus> = {
      openai: { configured: false, source: 'none', keyCount: 0, envDetected: false },
      deepseek: { configured: true, source: 'env', keyCount: 1, envVar: 'DEEPSEEK_API_KEY', envDetected: true },
      ollama: { configured: true, source: 'local', keyCount: 0, envDetected: false },
    }
    const configured = [{ name: 'ollama', presetId: 'ollama', models: [] }]
    const available = unconfiguredBuiltinPresets(builtins, configured, creds, '')
    // ollama is already configured; deepseek (envDetected) sorts ahead of openai
    expect(available.map(p => p.id)).toEqual(['deepseek', 'openai'])

    const quick = buildQuickActivatedProvider(builtins[1]!, 'sk-1, sk-2')
    expect(quick).toMatchObject({
      name: 'deepseek',
      presetId: 'deepseek',
      enabled: true,
      type: 'openai-compatible',
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: 'sk-1, sk-2',
      models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
    })
  })

  it('counts multi-keys and computes accurate protocol endpoint previews', () => {
    expect(countEnteredKeys('')).toBe(0)
    expect(countEnteredKeys('sk-1, sk-2\nsk-1')).toBe(2)

    expect(resolveEndpointPreview('openai-compatible', 'https://api.deepseek.com/v1/')).toBe('POST https://api.deepseek.com/v1/chat/completions')
    expect(resolveEndpointPreview('anthropic', 'https://api.anthropic.com/v1')).toBe('POST https://api.anthropic.com/v1/messages')
    expect(resolveEndpointPreview('google', '')).toBe('POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent')
  })

  it('filters presets and round-trips single-provider JSON with validation', () => {
    const presets: ProviderPreset[] = [
      { id: 'deepseek', label: 'DeepSeek', type: 'openai-compatible', apiKeyEnv: 'DEEPSEEK_API_KEY' },
      { id: 'openai', label: 'OpenAI', type: 'openai', apiKeyEnv: 'OPENAI_API_KEY' },
      { id: 'custom', label: 'Custom', type: 'openai-compatible' },
    ]
    expect(filterPresets(presets, '').map(p => p.id)).toEqual(['deepseek', 'openai'])
    expect(filterPresets(presets, 'DEEPSEEK_API_KEY').map(p => p.id)).toEqual(['deepseek'])

    const list = [
      { name: 'openai', type: 'openai', models: [{ id: 'gpt-5', name: 'GPT-5' }] },
      { name: 'gateway', type: 'openai-compatible', baseURL: 'https://openrouter.ai/api/v1', models: [{ id: 'deepseek-r1', name: 'R1' }] },
    ]
    expect(filterProviderIndices(list, 'openrouter')).toEqual([1])

    expect(hasCustomModelLimits({ id: 'm1', name: 'M1' })).toBe(false)
    expect(hasCustomModelLimits({ id: 'm1', name: 'M1', contextWindow: '128000' })).toBe(true)

    const json = serializeSingleProviderJson({
      name: 'my-gateway',
      presetId: 'openrouter',
      enabled: false,
      type: 'openai-compatible',
      baseURL: 'https://gw.example.com/v1',
      models: [{ id: 'qwen-max', name: 'Qwen Max', contextWindow: '131072' }],
    })
    const parsed = parseSingleProviderJson(json)
    expect(parsed).toMatchObject({
      name: 'my-gateway',
      presetId: 'openrouter',
      enabled: false,
      models: [{ id: 'qwen-max', name: 'Qwen Max', contextWindow: 131072 }],
    })
  })

  it('reorders providers for a drop before or after another card', () => {
    const list = ['a', 'b', 'c', 'd']
    expect(reorderProviders(list, 0, 2, true)).toEqual(['b', 'c', 'a', 'd'])
    expect(reorderProviders(list, 0, 2, false)).toEqual(['b', 'a', 'c', 'd'])
    expect(reorderProviders(list, 3, 0, false)).toEqual(['d', 'a', 'b', 'c'])
    expect(reorderProviders(list, 1, 2, true)).toEqual(['a', 'c', 'b', 'd'])
    expect(reorderProviders(list, 2, 2, true)).toBeUndefined()
    expect(reorderProviders(list, 1, 1, false)).toBeUndefined()
    expect(reorderProviders(list, -1, 2, false)).toBeUndefined()
    expect(reorderProviders(list, 1, 9, false)).toBeUndefined()
    expect(reorderProviders([], 0, 0, false)).toBeUndefined()
  })
})
