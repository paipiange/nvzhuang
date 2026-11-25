import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { echoGuidance, useAudioInputDevices, useAudioOutputDevices, useReconnectController } from './useVoiceOperations'

describe('voice operations', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('uses bounded exponential reconnect delays and stops after the configured limit', async () => {
    vi.useFakeTimers()
    const reconnect = useReconnectController({ baseDelay: 100, maxDelay: 250, maxAttempts: 3 })
    const task = vi.fn()
    expect(reconnect.schedule(task)).toBe(true)
    expect([reconnect.attempt.value, reconnect.delayMs.value]).toEqual([1, 100])
    await vi.advanceTimersByTimeAsync(100)
    expect(task).toHaveBeenCalledTimes(1)
    expect(reconnect.schedule(task)).toBe(true)
    expect(reconnect.delayMs.value).toBe(200)
    await vi.advanceTimersByTimeAsync(200)
    expect(reconnect.schedule(task)).toBe(true)
    expect(reconnect.delayMs.value).toBe(250)
    await vi.advanceTimersByTimeAsync(250)
    expect(reconnect.schedule(task)).toBe(false)
    expect(reconnect.status.value).toBe('exhausted')
  })

  it('waits while offline, retries immediately online, and supports manual cancel', () => {
    const reconnect = useReconnectController()
    const task = vi.fn()
    reconnect.handleOffline()
    reconnect.schedule(task)
    expect(reconnect.status.value).toBe('waiting-network')
    reconnect.handleOnline()
    expect(task).toHaveBeenCalledOnce()
    reconnect.schedule(task)
    reconnect.cancel()
    expect(reconnect.retryNow()).toBe(false)
    expect(reconnect.attempt.value).toBe(0)
  })

  it('enumerates microphones, persists a selection, and falls back when it disappears', async () => {
    let devices: MediaDeviceInfo[] = [
      { kind: 'audioinput', deviceId: 'mic-a', label: 'USB Mic', groupId: '', toJSON: () => ({}) },
      { kind: 'videoinput', deviceId: 'cam', label: 'Camera', groupId: '', toJSON: () => ({}) },
    ]
    const enumerateDevices = vi.fn(async () => devices)
    vi.stubGlobal('navigator', { onLine: true, mediaDevices: { enumerateDevices, addEventListener: vi.fn(), removeEventListener: vi.fn() } })
    const inputs = useAudioInputDevices()
    await inputs.refresh()
    expect(inputs.devices.value).toEqual([{ id: 'mic-a', label: 'USB Mic' }])
    inputs.select('mic-a')
    expect(localStorage.getItem('nvzhuang:voice-input:v1')).toBe('mic-a')
    devices = []
    await inputs.refresh()
    expect(inputs.selectedDeviceId.value).toBe('')
  })

  it('enumerates and persists an audio output device', async () => {
    const enumerateDevices = vi.fn(async () => [
      { kind: 'audiooutput', deviceId: 'speaker-a', label: 'USB Headset', groupId: '', toJSON: () => ({}) },
    ] as MediaDeviceInfo[])
    vi.stubGlobal('navigator', { onLine: true, mediaDevices: { enumerateDevices, addEventListener: vi.fn(), removeEventListener: vi.fn() } })
    const outputs = useAudioOutputDevices()
    await outputs.refresh()
    outputs.select('speaker-a')
    expect(outputs.devices.value).toEqual([{ id: 'speaker-a', label: 'USB Headset' }])
    expect(localStorage.getItem('nvzhuang:voice-output:v1')).toBe('speaker-a')
  })

  it('reports actionable echo processing guidance', () => {
    expect(echoGuidance({ deviceLabel: 'USB', echoCancellation: false })).toContain('佩戴耳机')
    expect(echoGuidance({ deviceLabel: 'USB', echoCancellation: true, noiseSuppression: true })).toContain('降噪')
    expect(echoGuidance({ deviceLabel: 'native', native: true })).toContain('Android 原生')
  })
})
