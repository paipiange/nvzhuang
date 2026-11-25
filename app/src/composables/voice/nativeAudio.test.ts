import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { supportsDuplexCapture, usePcmCapture } from './usePcmCapture'
import { useStreamingPlayer } from './useStreamingPlayer'
import { getNativeAudioBridge, listenNativeAudio, pcmFromBase64, pcmToBase64 } from './nativeAudio'
import type { NativeAudioBridge, NativeAudioEvent } from './nativeAudio'

function createBridge() {
  return {
    supportsDuplex: vi.fn(() => true),
    startCapture: vi.fn(),
    stopCapture: vi.fn(),
    beginPlayback: vi.fn(),
    pushPlayback: vi.fn(),
    endPlayback: vi.fn(),
    clearPlayback: vi.fn(),
    dispose: vi.fn(),
  } satisfies NativeAudioBridge
}
type MockNativeAudioBridge = ReturnType<typeof createBridge>

function emit(event: NativeAudioEvent) {
  window.dispatchEvent(new CustomEvent('companion-audio', { detail: event }))
}

function frameBase64() {
  const frame = Uint8Array.from({ length: 640 }, (_, index) => index % 256)
  let binary = ''
  for (const byte of frame)
    binary += String.fromCharCode(byte)
  return btoa(binary)
}

const originalBridge = Object.getOwnPropertyDescriptor(window, 'CompanionAudio')
const originalPort = Object.getOwnPropertyDescriptor(window, 'CompanionAudioNative')

function setBridge(bridge?: NativeAudioBridge) {
  if (bridge)
    Object.defineProperty(window, 'CompanionAudio', { configurable: true, writable: true, value: bridge })
  else
    Reflect.deleteProperty(window, 'CompanionAudio')
}

beforeEach(() => {
  vi.useRealTimers()
  setBridge(createBridge())
})

afterEach(() => {
  vi.useRealTimers()
  if (originalBridge)
    Object.defineProperty(window, 'CompanionAudio', originalBridge)
  else
    Reflect.deleteProperty(window, 'CompanionAudio')
  if (originalPort)
    Object.defineProperty(window, 'CompanionAudioNative', originalPort)
  else
    Reflect.deleteProperty(window, 'CompanionAudioNative')
})

describe('native CompanionAudio adapter with the real capture and playback composables', () => {
  it('prefers the native adapter and safely reports an unsupported platform', async () => {
    const unsupported = createBridge()
    unsupported.supportsDuplex.mockReturnValue(false)
    setBridge(unsupported)
    expect(supportsDuplexCapture()).toBe(false)
    expect(getNativeAudioBridge()).toBeUndefined()
    const capture = usePcmCapture()
    await expect(capture.start(vi.fn(), vi.fn())).rejects.toThrow('duplex_not_supported')

    const bridge = createBridge()
    setBridge(bridge)
    expect(supportsDuplexCapture()).toBe(true)
    expect(getNativeAudioBridge()).toBe(bridge)
  })

  it('adapts the Android WebMessage port and dispatches validated native events', () => {
    setBridge()
    const port = { postMessage: vi.fn(), onmessage: null as ((event: MessageEvent<string>) => void) | null }
    Object.defineProperty(window, 'CompanionAudioNative', { configurable: true, value: port })
    const handler = vi.fn()
    const release = listenNativeAudio(handler)
    const bridge = getNativeAudioBridge() as MockNativeAudioBridge
    expect(bridge.supportsDuplex()).toBe(true)
    bridge.startCapture('capture-1')
    expect(JSON.parse(port.postMessage.mock.calls[0][0])).toEqual({ type: 'startCapture', id: 'capture-1' })
    port.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'capture.started', sessionId: 'capture-1' }) }))
    expect(handler).toHaveBeenCalledWith({ type: 'capture.started', sessionId: 'capture-1' })
    port.onmessage?.(new MessageEvent('message', { data: '{bad json' }))
    expect(handler).toHaveBeenCalledOnce()
    release()
  })

  it('starts native capture and decodes only matching 20 ms PCM frames', async () => {
    const bridge = getNativeAudioBridge() as MockNativeAudioBridge
    const capture = usePcmCapture()
    const onFrame = vi.fn()
    const onEnded = vi.fn()
    const started = capture.start(onFrame, onEnded)
    let startedSettled = false
    void started.then(() => {
      startedSettled = true
    })
    await Promise.resolve()
    expect(startedSettled).toBe(false)
    const sessionId = bridge.startCapture.mock.calls[0][0]
    emit({ type: 'capture.started', sessionId: 'old-capture' })
    emit({ type: 'capture.frame', sessionId, pcm: 'bad', rms: 0.1, peak: 0.2 })
    expect(onFrame).not.toHaveBeenCalled()
    emit({ type: 'capture.started', sessionId })
    await expect(started).resolves.toBe(true)

    const pcm = frameBase64()
    emit({ type: 'capture.frame', sessionId: 'old-capture', pcm, rms: 0.4, peak: 0.8 })
    emit({ type: 'capture.frame', sessionId, pcm, rms: 0.4, peak: 0.8 })
    expect(onFrame).toHaveBeenCalledOnce()
    expect(onFrame).toHaveBeenCalledWith({ pcm: pcmFromBase64(pcm), rms: 0.4, peak: 0.8 })
    emit({ type: 'capture.error', sessionId, code: 'microphone_denied' })
    expect(onEnded).toHaveBeenCalledOnce()

    capture.stop()
    expect(bridge.stopCapture).toHaveBeenCalledOnce()
  })

  it('rejects native startup errors and releases an outstanding permission request on stop', async () => {
    const bridge = getNativeAudioBridge() as MockNativeAudioBridge
    const capture = usePcmCapture()
    const failed = capture.start(vi.fn(), vi.fn())
    const failedId = bridge.startCapture.mock.calls[0][0]
    emit({ type: 'capture.error', sessionId: failedId, code: 'duplex_not_supported' })
    await expect(failed).rejects.toThrow('duplex_not_supported')

    const pending = capture.start(vi.fn(), vi.fn())
    const pendingId = bridge.startCapture.mock.calls.at(-1)![0]
    capture.stop()
    await expect(pending).resolves.toBe(false)
    expect(bridge.stopCapture).toHaveBeenCalled()
    emit({ type: 'capture.started', sessionId: pendingId })
    expect(bridge.startCapture).toHaveBeenCalledTimes(2)
  })

  it('times out a native capture request with a safe permission error and stops the bridge', async () => {
    vi.useFakeTimers()
    const bridge = getNativeAudioBridge() as MockNativeAudioBridge
    const capture = usePcmCapture()
    const pending = capture.start(vi.fn(), vi.fn())
    const rejection = expect(pending).rejects.toThrow('microphone_denied')
    await vi.advanceTimersByTimeAsync(30000)
    await rejection
    expect(bridge.stopCapture).toHaveBeenCalledOnce()
  })

  it('begins native playback, sends bounded PCM base64 and awaits the matching completion event', async () => {
    const bridge = getNativeAudioBridge() as MockNativeAudioBridge
    const onComplete = vi.fn()
    const onLevel = vi.fn()
    const player = useStreamingPlayer(onComplete, onLevel)
    await player.prepare()
    player.begin('turn-a')
    const playbackId = bridge.beginPlayback.mock.calls[0][0]
    expect(playbackId).toMatch(/^playback-/)
    const pcm = new Int16Array([0x1234, -1, 0x2000]).buffer
    expect(player.push('turn-a', pcm)).toBe(true)
    expect(bridge.pushPlayback).toHaveBeenCalledWith(playbackId, pcmToBase64(pcm))
    expect(bridge.endPlayback).not.toHaveBeenCalled()
    player.end('turn-a')
    expect(bridge.endPlayback).toHaveBeenCalledWith(playbackId)
    expect(onComplete).not.toHaveBeenCalled()
    emit({ type: 'playback.complete', playbackId: 'old-playback' })
    expect(onComplete).not.toHaveBeenCalled()
    emit({ type: 'playback.complete', playbackId })
    expect(onComplete).toHaveBeenCalledOnce()
    expect(onComplete).toHaveBeenCalledWith('turn-a')
    expect(onLevel).toHaveBeenLastCalledWith(0)
    player.dispose()
  })

  it('clears old playback IDs and reports asynchronous native playback failures', async () => {
    const bridge = getNativeAudioBridge() as MockNativeAudioBridge
    const onComplete = vi.fn()
    const onError = vi.fn()
    const player = useStreamingPlayer(onComplete, vi.fn(), onError)
    await player.prepare()
    player.begin('old-turn')
    const oldPlaybackId = bridge.beginPlayback.mock.calls[0][0]
    player.clear()
    player.begin('new-turn')
    const newPlaybackId = bridge.beginPlayback.mock.calls.at(-1)![0]
    expect(newPlaybackId).not.toBe(oldPlaybackId)
    player.end('new-turn')
    emit({ type: 'playback.complete', playbackId: oldPlaybackId })
    expect(onComplete).not.toHaveBeenCalled()
    emit({ type: 'playback.error', playbackId: newPlaybackId, code: 'audio_backpressure' })
    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith('audio_backpressure')
    emit({ type: 'playback.complete', playbackId: newPlaybackId })
    expect(onComplete).not.toHaveBeenCalled()
    player.dispose()
    expect(bridge.clearPlayback).toHaveBeenCalled()
  })

  it('removes native listeners and stops capture/playback resources on dispose', async () => {
    const bridge = getNativeAudioBridge() as MockNativeAudioBridge
    const capture = usePcmCapture()
    const captureStart = capture.start(vi.fn(), vi.fn())
    const sessionId = bridge.startCapture.mock.calls[0][0]
    emit({ type: 'capture.started', sessionId })
    await expect(captureStart).resolves.toBe(true)

    const onComplete = vi.fn()
    const player = useStreamingPlayer(onComplete)
    await player.prepare()
    player.begin('turn')
    const playbackId = bridge.beginPlayback.mock.calls.at(-1)![0]
    player.end('turn')
    capture.stop()
    player.dispose()
    expect(bridge.stopCapture).toHaveBeenCalledOnce()
    expect(bridge.clearPlayback).toHaveBeenCalled()
    emit({ type: 'playback.complete', playbackId })
    expect(onComplete).not.toHaveBeenCalled()

    const handler = vi.fn()
    const release = listenNativeAudio(handler)
    emit({ type: 'capture.started', sessionId: 'after-dispose' })
    expect(handler).toHaveBeenCalledOnce()
    release()
    emit({ type: 'capture.started', sessionId: 'after-release' })
    expect(handler).toHaveBeenCalledOnce()
  })
})
