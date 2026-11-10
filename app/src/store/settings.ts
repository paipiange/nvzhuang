import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getCurrentBaseUrl, getEnvBaseUrl } from '@/utils'

const SETTINGS_KEY = 'nvzhuang:settings:v1'

export interface ClientModelConfig {
  provider: 'gemini' | 'doubao' | 'openai'
  baseUrl: string
  apiKey: string
  model: string
}

export const useSettingsStore = defineStore('settings', () => {
  const serverBaseUrl = ref<string>(getCurrentBaseUrl())
  const useMock = ref<boolean>(false)
  const expertMode = ref<boolean>(false)
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
        if (stored.serverBaseUrl && typeof stored.serverBaseUrl === 'string' && stored.serverBaseUrl.trim())
          serverBaseUrl.value = stored.serverBaseUrl.trim().replace(/\/+$/, '')
        if (typeof stored.useMock === 'boolean')
          useMock.value = stored.useMock
        if (typeof stored.expertMode === 'boolean')
          expertMode.value = stored.expertMode
        if (stored.clientConfig)
          clientConfig.value = { ...clientConfig.value, ...stored.clientConfig }
      }
    }
    catch (e) {
      console.warn('Failed to load settings', e)
    }
  }

  const saveSettings = () => {
    try {
      const cleanUrl = serverBaseUrl.value.trim().replace(/\/+$/, '')
      serverBaseUrl.value = cleanUrl
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
    clientConfig,
    saveSettings,
    resetSettings,
    loadSettings,
  }
})
