import { readonly, shallowRef } from 'vue'
import { CHARACTER_PRESETS_STORAGE_KEY } from '@/composables/character/useCharacterPresets'
import { CHARACTER_STORAGE_KEY } from '@/composables/character/useCharacter'
import { CONVERSATION_ARCHIVE_STORAGE_KEY, CONVERSATION_RETENTION_STORAGE_KEY } from '@/composables/voice/conversationArchive'
import { VOICE_INPUT_STORAGE_KEY, VOICE_OUTPUT_STORAGE_KEY } from '@/composables/voice/useVoiceOperations'
import { VOICE_PROVIDER_STORAGE_KEY } from '@/composables/voice/useVoiceProviderPreference'

const COMPANION_STORAGE_CATEGORIES = Object.freeze([
  { key: 'character', label: '角色与造型', storageKeys: [CHARACTER_STORAGE_KEY, CHARACTER_PRESETS_STORAGE_KEY] },
  { key: 'conversation', label: '对话与保留期限', storageKeys: [CONVERSATION_ARCHIVE_STORAGE_KEY, CONVERSATION_RETENTION_STORAGE_KEY] },
  { key: 'audio', label: '音频设备偏好', storageKeys: [VOICE_INPUT_STORAGE_KEY, VOICE_OUTPUT_STORAGE_KEY] },
  { key: 'provider', label: '语音引擎偏好', storageKeys: [VOICE_PROVIDER_STORAGE_KEY] },
])
export const COMPANION_STORAGE_KEYS = Object.freeze(COMPANION_STORAGE_CATEGORIES.flatMap(category => category.storageKeys))
export const COMPANION_STORAGE_SOFT_LIMIT_BYTES = 512 * 1024
const COMPANION_STORAGE_PROBE_KEY = 'nvzhuang:companion-storage-probe:v1'

export interface CompanionPrivacySummary {
  entries: number
  bytes: number
  status: 'healthy' | 'warning' | 'error'
  writable: boolean
  readErrors: number
  message: string
  categories: Array<{ key: string, label: string, entries: number, bytes: number }>
}

function readKnown(key: string) {
  try {
    if (typeof localStorage !== 'undefined') {
      const value = localStorage.getItem(key)
      return { exists: value !== null, value, error: false }
    }
    if (typeof uni !== 'undefined') {
      const value = uni.getStorageSync(key)
      return { exists: value !== undefined && value !== null && value !== '', value, error: false }
    }
  }
  catch {
    return { exists: false, value: null, error: true }
  }
  return { exists: false, value: null, error: true }
}

function valueBytes(value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value) || ''
  return typeof TextEncoder === 'function' ? new TextEncoder().encode(text).byteLength : text.length * 2
}

function inspect(): CompanionPrivacySummary {
  let entries = 0
  let bytes = 0
  let readErrors = 0
  const categories = COMPANION_STORAGE_CATEGORIES.map((category) => {
    let categoryEntries = 0
    let categoryBytes = 0
    for (const key of category.storageKeys) {
      const stored = readKnown(key)
      if (stored.error)
        readErrors++
      if (!stored.exists)
        continue
      categoryEntries++
      categoryBytes += valueBytes(stored.value)
    }
    entries += categoryEntries
    bytes += categoryBytes
    return { key: category.key, label: category.label, entries: categoryEntries, bytes: categoryBytes }
  })
  const writable = probeWritable()
  const status = !writable || readErrors
    ? 'error'
    : bytes >= COMPANION_STORAGE_SOFT_LIMIT_BYTES * 0.75 ? 'warning' : 'healthy'
  const message = status === 'error'
    ? '陪伴数据存储不可用或读取异常，请先导出备份再检查浏览器/App 存储权限。'
    : status === 'warning'
      ? '陪伴数据接近本模块建议容量上限，建议导出备份并清理不需要的记录。'
      : '陪伴数据存储读写正常。'
  return { entries, bytes, status, writable, readErrors, message, categories }
}

function probeWritable() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(COMPANION_STORAGE_PROBE_KEY, '1')
      localStorage.removeItem(COMPANION_STORAGE_PROBE_KEY)
      return true
    }
    if (typeof uni !== 'undefined') {
      uni.setStorageSync(COMPANION_STORAGE_PROBE_KEY, '1')
      uni.removeStorageSync(COMPANION_STORAGE_PROBE_KEY)
      return true
    }
  }
  catch {}
  return false
}

function removeKnown(key: string) {
  try {
    if (typeof localStorage !== 'undefined')
      localStorage.removeItem(key)
    else if (typeof uni !== 'undefined')
      uni.removeStorageSync(key)
  }
  catch {}
}

export function useCompanionPrivacy() {
  const summary = shallowRef(inspect())

  function refresh() {
    summary.value = inspect()
  }

  function clearLocalData() {
    refresh()
    const removed = summary.value.entries
    COMPANION_STORAGE_KEYS.forEach(removeKnown)
    removeKnown(COMPANION_STORAGE_PROBE_KEY)
    refresh()
    return removed
  }

  return { summary: readonly(summary), refresh, clearLocalData }
}
