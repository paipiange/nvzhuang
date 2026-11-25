import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from './settings'

describe('useSettingsStore memory-only device voice settings', () => {
  beforeEach(() => {
    vi.mocked(uni.getStorageSync).mockReturnValue(null)
  })

  it('removes a legacy persisted voice key without loading it into memory', () => {
    vi.mocked(uni.getStorageSync).mockReturnValue({ useMock: true, seedVoiceApiKey: 'voice-key-placeholder' })
    const store = useSettingsStore()
    expect(store.seedVoiceApiKey).toBe('')
    expect(store.useMock).toBe(true)
    expect(uni.setStorageSync).toHaveBeenCalledWith(
      'nvzhuang:settings:v1',
      expect.not.objectContaining({ seedVoiceApiKey: expect.anything() }),
    )
  })

  it('never reloads a voice key from persistent settings', () => {
    vi.mocked(uni.getStorageSync).mockReturnValue({ seedVoiceApiKey: 'x'.repeat(2049) })
    const store = useSettingsStore()
    expect(store.seedVoiceApiKey).toBe('')
  })

  it('keeps the voice key in memory and excludes it from saved settings', () => {
    const store = useSettingsStore()
    store.seedVoiceApiKey = 'voice-key-placeholder'
    store.saveSettings()
    expect(uni.setStorageSync).toHaveBeenLastCalledWith(
      'nvzhuang:settings:v1',
      expect.not.objectContaining({ seedVoiceApiKey: expect.anything() }),
    )
    expect(store.seedVoiceApiKey).toBe('voice-key-placeholder')

    store.resetSettings()
    expect(store.seedVoiceApiKey).toBe('')
    expect(uni.setStorageSync).toHaveBeenLastCalledWith(
      'nvzhuang:settings:v1',
      expect.not.objectContaining({ seedVoiceApiKey: expect.anything() }),
    )
  })

  it('sanitizes persisted settings to the explicit schema', () => {
    vi.mocked(uni.getStorageSync).mockReturnValue({
      serverBaseUrl: 'http://unsafe.example.com',
      useMock: 'yes',
      expertMode: true,
      seedVoiceApiKey: 'legacy-secret-placeholder',
      unexpected: 'drop-me',
      clientConfig: {
        provider: 'unknown',
        apiKey: 123,
        baseUrl: 'http://models.example.com',
        model: ['bad'],
        unexpected: 'drop-me',
      },
    })

    const store = useSettingsStore()
    expect(store.serverBaseUrl).toBe('http://127.0.0.1:8000')
    expect(store.useMock).toBe(false)
    expect(store.expertMode).toBe(true)
    expect(store.clientConfig).toEqual({ provider: 'gemini', apiKey: '', baseUrl: '', model: '' })
    expect(uni.setStorageSync).toHaveBeenLastCalledWith('nvzhuang:settings:v1', {
      serverBaseUrl: 'http://127.0.0.1:8000',
      useMock: false,
      expertMode: true,
      clientConfig: { provider: 'gemini', apiKey: '', baseUrl: '', model: '' },
    })
  })
})
