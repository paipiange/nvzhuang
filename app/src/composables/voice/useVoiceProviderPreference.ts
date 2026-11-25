import { readonly, ref } from 'vue'

export const VOICE_PROVIDER_STORAGE_KEY = 'nvzhuang:voice-provider:v1'
export const VOICE_PROVIDERS = Object.freeze(['local', 'seeduplex', 'open-llm-vtuber'] as const)
export type VoiceProvider = typeof VOICE_PROVIDERS[number]

function isVoiceProvider(value: unknown): value is VoiceProvider {
  return typeof value === 'string' && VOICE_PROVIDERS.includes(value as VoiceProvider)
}

function readPreference(): VoiceProvider {
  try {
    const value = typeof localStorage !== 'undefined'
      ? localStorage.getItem(VOICE_PROVIDER_STORAGE_KEY)
      : typeof uni !== 'undefined' ? uni.getStorageSync(VOICE_PROVIDER_STORAGE_KEY) : null
    return isVoiceProvider(value) ? value : 'local'
  }
  catch {
    return 'local'
  }
}

function writePreference(value: VoiceProvider) {
  try {
    if (typeof localStorage !== 'undefined')
      localStorage.setItem(VOICE_PROVIDER_STORAGE_KEY, value)
    else if (typeof uni !== 'undefined')
      uni.setStorageSync(VOICE_PROVIDER_STORAGE_KEY, value)
  }
  catch {}
}

function removePreference() {
  try {
    if (typeof localStorage !== 'undefined')
      localStorage.removeItem(VOICE_PROVIDER_STORAGE_KEY)
    else if (typeof uni !== 'undefined')
      uni.removeStorageSync(VOICE_PROVIDER_STORAGE_KEY)
  }
  catch {}
}

export function useVoiceProviderPreference() {
  const provider = ref<VoiceProvider>(readPreference())

  function select(value: unknown) {
    if (!isVoiceProvider(value))
      return false
    provider.value = value
    writePreference(value)
    return true
  }

  function reset() {
    provider.value = 'local'
    removePreference()
  }

  return { provider: readonly(provider), select, reset }
}
