import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getCurrentBaseUrl, getEnvBaseUrl } from '@/utils'
import { normalizeModelBaseUrl, normalizeServiceBaseUrl } from '@/utils/serviceEndpoint'

const SETTINGS_KEY = 'nvzhuang:settings:v1'

export interface ClientModelConfig {
  provider: 'gemini' | 'doubao' | 'openai'
  baseUrl: string
  apiKey: string
  model: string
}

const MODEL_PROVIDERS = ['gemini', 'doubao', 'openai'] as const

function safeText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function safeServiceUrl(value: unknown, fallback: string) {
  try {
    return normalizeServiceBaseUrl(typeof value === 'string' && value.trim() ? value : fallback)
  }
  catch {
    return 'http://127.0.0.1:8000'
  }
}

function sanitizeClientConfig(value: unknown): ClientModelConfig {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const provider = MODEL_PROVIDERS.includes(input.provider as ClientModelConfig['provider']) ? input.provider as ClientModelConfig['provider'] : 'gemini'
  let baseUrl = safeText(input.baseUrl, 2048)
  try {
    if (baseUrl)
      baseUrl = normalizeModelBaseUrl(baseUrl)
  }
  catch {
    baseUrl = ''
  }
  return {
    provider,
    baseUrl,
    apiKey: safeText(input.apiKey, 4096),
    model: safeText(input.model, 200),
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const serverBaseUrl = ref<string>(getCurrentBaseUrl())
  const useMock = ref<boolean>(false)
  const expertMode = ref<boolean>(false)
  const seedVoiceApiKey = ref<string>('')
  const clientConfig = ref<ClientModelConfig>({
    provider: 'gemini',
    baseUrl: '',
    apiKey: '',
    model: '',
  })

  const loadSettings = () => {
    try {
      const stored = uni.getStorageSync(SETTINGS_KEY)
      if (stored && typeof stored === 'object') {
        serverBaseUrl.value = safeServiceUrl(stored.serverBaseUrl, getEnvBaseUrl())
        if (typeof stored.useMock === 'boolean')
          useMock.value = stored.useMock
        if (typeof stored.expertMode === 'boolean')
          expertMode.value = stored.expertMode
        clientConfig.value = sanitizeClientConfig(stored.clientConfig)
        uni.setStorageSync(SETTINGS_KEY, {
          serverBaseUrl: serverBaseUrl.value,
          useMock: useMock.value,
          expertMode: expertMode.value,
          clientConfig: clientConfig.value,
        })
      }
    }
    catch (e) {
      console.warn('Failed to load settings', e)
    }
  }

  const saveSettings = () => {
    try {
      const cleanUrl = safeServiceUrl(serverBaseUrl.value, getEnvBaseUrl())
      serverBaseUrl.value = cleanUrl
      clientConfig.value = sanitizeClientConfig(clientConfig.value)
      uni.setStorageSync(SETTINGS_KEY, {
        serverBaseUrl: cleanUrl,
        useMock: useMock.value,
        expertMode: expertMode.value,
        clientConfig: clientConfig.value,
      })
    }
    catch (e) {
      console.warn('Failed to save settings', e)
    }
  }

  const resetSettings = () => {
    serverBaseUrl.value = getEnvBaseUrl()
    useMock.value = false
    expertMode.value = false
    seedVoiceApiKey.value = ''
    clientConfig.value = {
      provider: 'gemini',
      baseUrl: '',
      apiKey: '',
      model: '',
    }
    saveSettings()
  }

  loadSettings()

  return {
    serverBaseUrl,
    useMock,
    expertMode,
    seedVoiceApiKey,
    clientConfig,
    saveSettings,
    resetSettings,
    loadSettings,
  }
})
