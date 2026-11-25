import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useVoiceProviderPreference, VOICE_PROVIDER_STORAGE_KEY } from './useVoiceProviderPreference'

const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
  })
})

afterEach(() => Reflect.deleteProperty(globalThis, 'localStorage'))

describe('useVoiceProviderPreference', () => {
  it('loads and saves only an allowed provider enum', () => {
    localStorage.setItem(VOICE_PROVIDER_STORAGE_KEY, 'seeduplex')
    const preference = useVoiceProviderPreference()
    expect(preference.provider.value).toBe('seeduplex')
    expect(preference.select('open-llm-vtuber')).toBe(true)
    expect(localStorage.getItem(VOICE_PROVIDER_STORAGE_KEY)).toBe('open-llm-vtuber')
  })

  it('rejects keys, URLs, objects and arbitrary strings', () => {
    const preference = useVoiceProviderPreference()
    const invalidValues = [
      'https://voice.example.invalid',
      'key-value-that-must-not-be-stored',
      { provider: 'seeduplex', apiKey: 'private' },
      'custom-provider',
    ]
    invalidValues.forEach(value => expect(preference.select(value)).toBe(false))
    expect(preference.provider.value).toBe('local')
    expect(localStorage.getItem(VOICE_PROVIDER_STORAGE_KEY)).toBeNull()
  })

  it('falls back from invalid storage and removes the preference on reset', () => {
    localStorage.setItem(VOICE_PROVIDER_STORAGE_KEY, 'https://private.invalid')
    const preference = useVoiceProviderPreference()
    expect(preference.provider.value).toBe('local')
    preference.select('seeduplex')
    preference.reset()
    expect(preference.provider.value).toBe('local')
    expect(localStorage.getItem(VOICE_PROVIDER_STORAGE_KEY)).toBeNull()
  })
})
