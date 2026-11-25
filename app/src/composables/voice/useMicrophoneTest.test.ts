import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMicrophoneTest } from './useMicrophoneTest'
import type { CaptureFrame, CaptureOptions } from './usePcmCapture'

function captureMock() {
  let frameHandler: ((frame: CaptureFrame) => void) | undefined
  let endedHandler: (() => void) | undefined
  let captureOptions: CaptureOptions | undefined
  return {
    adapter: {
      start: vi.fn(async (onFrame: (frame: CaptureFrame) => void, onEnded: () => void, options?: CaptureOptions) => {
        frameHandler = onFrame
        endedHandler = onEnded
        captureOptions = options
        return true
      }),
      stop: vi.fn(),
    },
    frame: (rms: number, peak: number) => frameHandler?.({ pcm: new ArrayBuffer(0), rms, peak }),
    end: () => endedHandler?.(),
    options: () => captureOptions,
  }
}

afterEach(() => vi.useRealTimers())

describe('useMicrophoneTest', () => {
  it('detects a local input signal and discards capture on finish', async () => {
    const capture = captureMock()
    const test = useMicrophoneTest({ durationMs: 1000 }, capture.adapter)
    const configured = vi.fn()
    expect(await test.start('device-a', configured)).toBe(true)
    expect(capture.options()).toMatchObject({ deviceId: 'device-a', onConfigured: configured })
    capture.frame(0.01, 0.08)
    expect(test.detected.value).toBe(true)
    test.finish()
    expect(test.status.value).toBe('passed')
    expect(capture.adapter.stop).toHaveBeenCalledOnce()
  })

  it('marks silence after the bounded test without uploading or storing audio', async () => {
    vi.useFakeTimers()
    const capture = captureMock()
    const test = useMicrophoneTest({ durationMs: 1000 }, capture.adapter)
    await test.start()
    capture.frame(0.0001, 0.001)
    vi.advanceTimersByTime(1000)
    expect(test.status.value).toBe('quiet')
    expect(capture.adapter.stop).toHaveBeenCalledOnce()
  })

  it('cancels pending capture and reports a disconnected microphone', async () => {
    const capture = captureMock()
    const test = useMicrophoneTest({}, capture.adapter)
    await test.start()
    capture.end()
    expect(test.status.value).toBe('error')
    expect(test.error.value).toBe('microphone_ended')
    test.cancel()
    expect(test.status.value).toBe('idle')
  })
})
