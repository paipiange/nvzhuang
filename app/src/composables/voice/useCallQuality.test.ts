import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCallQuality } from './useCallQuality'

afterEach(() => vi.useRealTimers())

describe('call quality', () => {
  it('tracks duration and resets a completed call', async () => {
    vi.useFakeTimers()
    const quality = useCallQuality()
    quality.start()
    await vi.advanceTimersByTimeAsync(3100)
    expect(quality.durationSeconds.value).toBe(3)
    quality.stop()
    quality.reset()
    expect(quality.durationSeconds.value).toBe(0)
  })

  it('grades reconnect and congestion pressure', () => {
    const quality = useCallQuality()
    expect(quality.grade.value).toBe('良好')
    quality.noteReconnect()
    expect(quality.grade.value).toBe('一般')
    quality.noteReconnect()
    quality.noteReconnect()
    expect(quality.grade.value).toBe('较差')
  })
})
