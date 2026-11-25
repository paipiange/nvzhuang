import { computed, readonly, ref, shallowRef } from 'vue'

export const VOICE_INPUT_STORAGE_KEY = 'nvzhuang:voice-input:v1'
export const VOICE_OUTPUT_STORAGE_KEY = 'nvzhuang:voice-output:v1'

export interface AudioInputDevice {
  id: string
  label: string
}

export interface CaptureDiagnostics {
  deviceLabel: string
  echoCancellation?: boolean
  noiseSuppression?: boolean
  autoGainControl?: boolean
  native?: boolean
}

function readLocal(key: string) {
  try {
    if (typeof localStorage !== 'undefined')
      return localStorage.getItem(key) || ''
    if (typeof uni !== 'undefined')
      return String(uni.getStorageSync(key) || '')
  }
  catch {}
  return ''
}

function writeLocal(key: string, value: string) {
  try {
    if (typeof localStorage !== 'undefined')
      localStorage.setItem(key, value)
    else if (typeof uni !== 'undefined')
      uni.setStorageSync(key, value)
  }
  catch {}
}

function safeDeviceLabel(label: string, index: number) {
  const clean = label.replace(/[\r\n\t]/g, ' ').trim().slice(0, 80)
  return clean || `麦克风 ${index + 1}`
}

export function useAudioInputDevices() {
  const devices = shallowRef<AudioInputDevice[]>([])
  const selectedDeviceId = ref(readLocal(VOICE_INPUT_STORAGE_KEY))
  const available = computed(() => devices.value.length > 0)
  let listening = false

  async function refresh() {
    const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
    if (!media?.enumerateDevices) {
      devices.value = []
      selectedDeviceId.value = ''
      return
    }
    try {
      const inputs = (await media.enumerateDevices()).filter(item => item.kind === 'audioinput')
      devices.value = inputs.map((item, index) => ({ id: item.deviceId, label: safeDeviceLabel(item.label, index) }))
      if (selectedDeviceId.value && !devices.value.some(item => item.id === selectedDeviceId.value))
        select('')
    }
    catch {
      devices.value = []
    }
  }

  function select(id: string) {
    const next = devices.value.some(item => item.id === id) ? id : ''
    selectedDeviceId.value = next
    writeLocal(VOICE_INPUT_STORAGE_KEY, next)
  }

  function start() {
    if (listening)
      return
    listening = true
    void refresh()
    if (typeof navigator !== 'undefined')
      navigator.mediaDevices?.addEventListener?.('devicechange', refresh)
  }

  function stop() {
    if (!listening)
      return
    listening = false
    if (typeof navigator !== 'undefined')
      navigator.mediaDevices?.removeEventListener?.('devicechange', refresh)
  }

  return { devices: readonly(devices), selectedDeviceId: readonly(selectedDeviceId), available, refresh, select, start, stop }
}

export function useAudioOutputDevices() {
  const devices = shallowRef<AudioInputDevice[]>([])
  const selectedDeviceId = ref(readLocal(VOICE_OUTPUT_STORAGE_KEY))
  const available = computed(() => devices.value.length > 0)
  let listening = false

  async function refresh() {
    const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
    if (!media?.enumerateDevices) {
      devices.value = []
      selectedDeviceId.value = ''
      return
    }
    try {
      const outputs = (await media.enumerateDevices()).filter(item => item.kind === 'audiooutput')
      devices.value = outputs.map((item, index) => ({ id: item.deviceId, label: safeDeviceLabel(item.label, index) }))
      if (selectedDeviceId.value && !devices.value.some(item => item.id === selectedDeviceId.value))
        select('')
    }
    catch {
      devices.value = []
    }
  }

  function select(id: string) {
    const next = devices.value.some(item => item.id === id) ? id : ''
    selectedDeviceId.value = next
    writeLocal(VOICE_OUTPUT_STORAGE_KEY, next)
  }

  function start() {
    if (listening)
      return
    listening = true
    void refresh()
    if (typeof navigator !== 'undefined')
      navigator.mediaDevices?.addEventListener?.('devicechange', refresh)
  }

  function stop() {
    if (!listening)
      return
    listening = false
    if (typeof navigator !== 'undefined')
      navigator.mediaDevices?.removeEventListener?.('devicechange', refresh)
  }

  return { devices: readonly(devices), selectedDeviceId: readonly(selectedDeviceId), available, refresh, select, start, stop }
}

export function useReconnectController(options: { baseDelay?: number, maxDelay?: number, maxAttempts?: number } = {}) {
  const baseDelay = Math.max(100, options.baseDelay ?? 1000)
  const maxDelay = Math.max(baseDelay, options.maxDelay ?? 15000)
  const maxAttempts = Math.max(1, options.maxAttempts ?? 5)
  const online = ref(typeof navigator === 'undefined' || navigator.onLine !== false)
  const attempt = ref(0)
  const delayMs = ref(0)
  const status = ref<'idle' | 'waiting-network' | 'scheduled' | 'exhausted'>('idle')
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: (() => void | Promise<void>) | undefined
  let listening = false

  function clearTimer() {
    if (timer)
      clearTimeout(timer)
    timer = undefined
  }

  function runPending() {
    const task = pending
    pending = undefined
    clearTimer()
    status.value = 'idle'
    delayMs.value = 0
    if (task)
      void task()
  }

  function schedule(task: () => void | Promise<void>) {
    clearTimer()
    pending = task
    if (attempt.value >= maxAttempts) {
      status.value = 'exhausted'
      delayMs.value = 0
      return false
    }
    attempt.value++
    if (!online.value) {
      status.value = 'waiting-network'
      delayMs.value = 0
      return true
    }
    delayMs.value = Math.min(maxDelay, baseDelay * 2 ** (attempt.value - 1))
    status.value = 'scheduled'
    timer = setTimeout(runPending, delayMs.value)
    return true
  }

  function retryNow() {
    if (!pending)
      return false
    runPending()
    return true
  }

  function cancel(resetAttempts = true) {
    clearTimer()
    pending = undefined
    status.value = 'idle'
    delayMs.value = 0
    if (resetAttempts)
      attempt.value = 0
  }

  function markConnected() {
    cancel(true)
  }

  function handleOnline() {
    online.value = true
    if (status.value === 'waiting-network')
      retryNow()
  }

  function handleOffline() {
    online.value = false
    if (pending) {
      clearTimer()
      status.value = 'waiting-network'
      delayMs.value = 0
    }
  }

  function start() {
    if (listening || typeof window === 'undefined')
      return
    listening = true
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
  }

  function stop() {
    if (listening && typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
    listening = false
    cancel()
  }

  return { online: readonly(online), attempt: readonly(attempt), delayMs: readonly(delayMs), status: readonly(status), schedule, retryNow, cancel, markConnected, start, stop, handleOnline, handleOffline }
}

export function echoGuidance(info?: CaptureDiagnostics) {
  if (!info)
    return '尚未取得麦克风处理信息；开始通话后会显示实际回声处理状态。'
  if (info.native)
    return 'Android 原生通话已启用系统音频处理；扬声器免提仍建议控制音量，出现回声时请佩戴耳机。'
  if (info.echoCancellation === false)
    return '当前麦克风未启用回声消除，建议佩戴耳机或在系统设置中开启回声消除。'
  const enhancements = [info.noiseSuppression && '降噪', info.autoGainControl && '自动增益'].filter(Boolean).join('、')
  return `系统回声消除已启用${enhancements ? `，同时启用${enhancements}` : ''}；如仍有回声请降低扬声器音量或佩戴耳机。`
}
