import { computed, readonly, ref } from 'vue'
import { usePcmCapture } from './usePcmCapture'
import type { CaptureFrame, CaptureOptions } from './usePcmCapture'
import type { CaptureDiagnostics } from './useVoiceOperations'

export type MicrophoneTestStatus = 'idle' | 'starting' | 'listening' | 'passed' | 'quiet' | 'error'

interface MicrophoneCapture {
  start: (onFrame: (frame: CaptureFrame) => void, onEnded: () => void, options?: CaptureOptions) => Promise<boolean>
  stop: () => void
}

export interface MicrophoneTestOptions {
  durationMs?: number
  rmsThreshold?: number
  peakThreshold?: number
}

function errorCode(error: unknown) {
  const code = error instanceof Error ? error.message : ''
  return ['duplex_not_supported', 'microphone_denied'].includes(code) ? code : 'microphone_unavailable'
}

export function useMicrophoneTest(options: MicrophoneTestOptions = {}, capture: MicrophoneCapture = usePcmCapture()) {
  const durationMs = Math.max(1000, Math.min(15000, options.durationMs ?? 8000))
  const rmsThreshold = Math.max(0, options.rmsThreshold ?? 0.003)
  const peakThreshold = Math.max(0, options.peakThreshold ?? 0.02)
  const status = ref<MicrophoneTestStatus>('idle')
  const rms = ref(0)
  const peak = ref(0)
  const maxRms = ref(0)
  const maxPeak = ref(0)
  const error = ref('')
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const active = computed(() => status.value === 'starting' || status.value === 'listening')
  const detected = computed(() => maxRms.value >= rmsThreshold || maxPeak.value >= peakThreshold)
  const levelText = computed(() => `RMS ${Math.max(-100, 20 * Math.log10(rms.value || 0.00001)).toFixed(0)} dBFS · 峰值 ${Math.max(-100, 20 * Math.log10(peak.value || 0.00001)).toFixed(0)} dBFS`)

  function clearTimer() {
    if (timer)
      clearTimeout(timer)
    timer = undefined
  }

  function finish() {
    if (!active.value)
      return
    generation++
    clearTimer()
    capture.stop()
    status.value = detected.value ? 'passed' : 'quiet'
  }

  function cancel() {
    generation++
    clearTimer()
    capture.stop()
    status.value = 'idle'
    rms.value = 0
    peak.value = 0
    maxRms.value = 0
    maxPeak.value = 0
    error.value = ''
  }

  async function start(deviceId = '', onConfigured?: (diagnostics: CaptureDiagnostics) => void) {
    if (active.value)
      return false
    const current = ++generation
    clearTimer()
    rms.value = 0
    peak.value = 0
    maxRms.value = 0
    maxPeak.value = 0
    error.value = ''
    status.value = 'starting'
    try {
      const started = await capture.start((frame) => {
        if (current !== generation)
          return
        rms.value = Math.max(0, frame.rms)
        peak.value = Math.max(0, frame.peak)
        maxRms.value = Math.max(maxRms.value, rms.value)
        maxPeak.value = Math.max(maxPeak.value, peak.value)
      }, () => {
        if (current === generation) {
          generation++
          error.value = 'microphone_ended'
          status.value = 'error'
          clearTimer()
          capture.stop()
        }
      }, { ...(deviceId ? { deviceId } : {}), onConfigured })
      if (current !== generation)
        return false
      if (!started) {
        status.value = 'idle'
        return false
      }
      status.value = 'listening'
      timer = setTimeout(finish, durationMs)
      return true
    }
    catch (cause) {
      if (current !== generation)
        return false
      clearTimer()
      capture.stop()
      error.value = errorCode(cause)
      status.value = 'error'
      return false
    }
  }

  return {
    status: readonly(status),
    active,
    detected,
    rms: readonly(rms),
    peak: readonly(peak),
    maxRms: readonly(maxRms),
    maxPeak: readonly(maxPeak),
    error: readonly(error),
    levelText,
    start,
    finish,
    cancel,
  }
}
