import { computed, readonly, ref } from 'vue'
import { useStreamingPlayer } from './useStreamingPlayer'
import { OUTPUT_RATE } from './voiceProtocol'

export type SpeakerTestStatus = 'idle' | 'starting' | 'playing' | 'passed' | 'error'

export interface SpeakerTestPlayer {
  prepare: () => Promise<void>
  setOutputDevice: (deviceId: string) => Promise<void>
  begin: (id: string, rate?: number, channels?: number) => void
  push: (id: string, pcm: ArrayBuffer) => boolean
  end: (id: string) => void
  clear: () => void
  dispose: () => void
}

type SpeakerTestPlayerFactory = (onComplete: (id: string) => void, onError: (code: string) => void) => SpeakerTestPlayer

export function createSpeakerTestTone(durationMs = 450) {
  const safeDuration = Math.max(200, Math.min(1000, durationMs))
  const samples = Math.round(OUTPUT_RATE * safeDuration / 1000)
  const fadeSamples = Math.min(Math.round(OUTPUT_RATE * 0.02), Math.floor(samples / 2))
  const pcm = new ArrayBuffer(samples * 2)
  const view = new DataView(pcm)
  for (let index = 0; index < samples; index++) {
    const fadeIn = fadeSamples ? Math.min(1, index / fadeSamples) : 1
    const fadeOut = fadeSamples ? Math.min(1, (samples - index - 1) / fadeSamples) : 1
    const envelope = Math.max(0, Math.min(fadeIn, fadeOut))
    const sample = Math.sin(2 * Math.PI * 660 * index / OUTPUT_RATE) * 0.08 * envelope
    view.setInt16(index * 2, Math.round(sample * 32767), true)
  }
  return pcm
}

export function useSpeakerTest(playerFactory: SpeakerTestPlayerFactory = (onComplete, onError) => useStreamingPlayer(onComplete, () => {}, onError)) {
  const status = ref<SpeakerTestStatus>('idle')
  const error = ref('')
  let activeId = ''
  const player = playerFactory((id) => {
    if (id !== activeId)
      return
    activeId = ''
    status.value = 'passed'
  }, (code) => {
    if (!activeId)
      return
    activeId = ''
    error.value = code || 'speaker_test_failed'
    status.value = 'error'
  })
  const active = computed(() => status.value === 'starting' || status.value === 'playing')

  async function start(outputDeviceId = '') {
    if (active.value)
      return false
    const id = `speaker-test-${Date.now()}`
    activeId = id
    error.value = ''
    status.value = 'starting'
    try {
      await player.setOutputDevice(outputDeviceId)
      await player.prepare()
      await player.setOutputDevice(outputDeviceId)
      player.begin(id, OUTPUT_RATE, 1)
      player.push(id, createSpeakerTestTone())
      status.value = 'playing'
      player.end(id)
      return true
    }
    catch (cause) {
      if (activeId !== id)
        return false
      player.clear()
      activeId = ''
      error.value = cause instanceof Error && cause.message === 'output_device_not_supported'
        ? 'output_device_not_supported'
        : 'speaker_test_failed'
      status.value = 'error'
      return false
    }
  }

  function cancel() {
    activeId = ''
    player.clear()
    status.value = 'idle'
    error.value = ''
  }

  function dispose() {
    activeId = ''
    player.dispose()
    status.value = 'idle'
    error.value = ''
  }

  return { status: readonly(status), error: readonly(error), active, start, cancel, dispose }
}
