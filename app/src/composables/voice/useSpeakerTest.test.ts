import { describe, expect, it, vi } from 'vitest'
import { createSpeakerTestTone, useSpeakerTest } from './useSpeakerTest'
import type { SpeakerTestPlayer } from './useSpeakerTest'

function playerHarness() {
  let complete: (id: string) => void = () => {}
  let fail: (code: string) => void = () => {}
  const player: SpeakerTestPlayer = {
    prepare: vi.fn(async () => {}),
    setOutputDevice: vi.fn(async () => {}),
    begin: vi.fn(),
    push: vi.fn(() => true),
    end: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
  }
  const factory = (onComplete: (id: string) => void, onError: (code: string) => void) => {
    complete = onComplete
    fail = onError
    return player
  }
  return { player, factory, complete: (id: string) => complete(id), fail: (code: string) => fail(code) }
}

describe('useSpeakerTest', () => {
  it('creates a bounded low-volume local PCM tone with click-reducing fades', () => {
    const tone = createSpeakerTestTone(450)
    const view = new DataView(tone)
    let peak = 0
    for (let index = 0; index < tone.byteLength; index += 2)
      peak = Math.max(peak, Math.abs(view.getInt16(index, true)))

    expect(tone.byteLength).toBe(21600)
    expect(view.getInt16(0, true)).toBe(0)
    expect(Math.abs(view.getInt16(tone.byteLength - 2, true))).toBeLessThan(20)
    expect(peak).toBeLessThanOrEqual(Math.ceil(32767 * 0.08))
  })

  it('plays only generated PCM through the selected local output device', async () => {
    const harness = playerHarness()
    const test = useSpeakerTest(harness.factory)

    expect(await test.start('speaker-a')).toBe(true)
    const id = vi.mocked(harness.player.begin).mock.calls[0][0]
    expect(harness.player.setOutputDevice).toHaveBeenNthCalledWith(1, 'speaker-a')
    expect(harness.player.setOutputDevice).toHaveBeenNthCalledWith(2, 'speaker-a')
    expect(harness.player.push).toHaveBeenCalledWith(id, expect.any(ArrayBuffer))
    expect(test.status.value).toBe('playing')

    harness.complete(id)
    expect(test.status.value).toBe('passed')
  })

  it('reports unsupported output selection and releases playback state', async () => {
    const harness = playerHarness()
    vi.mocked(harness.player.setOutputDevice).mockRejectedValueOnce(new Error('output_device_not_supported'))
    const test = useSpeakerTest(harness.factory)

    expect(await test.start('speaker-a')).toBe(false)
    expect(test.status.value).toBe('error')
    expect(test.error.value).toBe('output_device_not_supported')
    expect(harness.player.clear).toHaveBeenCalledOnce()
  })
})
