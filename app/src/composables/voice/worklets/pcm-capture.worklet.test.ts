import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

interface WorkletFrame { pcm: ArrayBuffer, rms: number, peak: number }
interface Processor { process: (inputs: Float32Array[][]) => boolean }

function loadProcessor(rate: number) {
  const postMessage = vi.fn<(frame: WorkletFrame, transfers: ArrayBuffer[]) => void>()
  let Constructor: (new () => Processor) | undefined
  const scope = vm.createContext({
    sampleRate: rate,
    ArrayBuffer,
    DataView,
    AudioWorkletProcessor: class {
      port = { postMessage }
    },
    registerProcessor(name: string, processor: new () => Processor) {
      expect(name).toBe('pcm-capture')
      Constructor = processor
    },
  })
  const source = readFileSync(resolve('src/composables/voice/worklets/pcm-capture.worklet.js'), 'utf8')
  vm.runInContext(source, scope)
  if (!Constructor)
    throw new Error('Worklet did not register its processor')
  return { processor: new Constructor(), postMessage }
}

describe('pcm-capture AudioWorklet', () => {
  it.each([16000, 44100, 48000])('continuously produces 50 separate 640-byte frames per second at %i Hz', (rate) => {
    const { processor, postMessage } = loadProcessor(rate)
    const input = new Float32Array(rate).fill(0.5)
    for (let offset = 0; offset < input.length; offset += 128)
      expect(processor.process([[input.subarray(offset, offset + 128)]])).toBe(true)

    expect(postMessage).toHaveBeenCalledTimes(50)
    const buffers = new Set<ArrayBuffer>()
    for (const [frame, transfers] of postMessage.mock.calls) {
      expect(frame.pcm.byteLength).toBe(640)
      expect(transfers).toEqual([frame.pcm])
      expect(frame.rms).toBeCloseTo(0.5, 6)
      expect(frame.peak).toBe(0.5)
      const pcm = new DataView(frame.pcm)
      for (let sample = 0; sample < 320; sample++)
        expect(pcm.getInt16(sample * 2, true)).toBe(16383)
      buffers.add(frame.pcm)
    }
    expect(buffers.size).toBe(50)
  })

  it('preserves fractional resampling phase and sample order across render quanta', () => {
    const input = Float32Array.from({ length: 4410 }, (_, index) => Math.sin(index / 37) * 0.8)
    const contiguous = loadProcessor(44100)
    const chunked = loadProcessor(44100)
    contiguous.processor.process([[input]])
    for (let offset = 0; offset < input.length; offset += 128)
      chunked.processor.process([[input.subarray(offset, offset + 128)]])

    expect(chunked.postMessage).toHaveBeenCalledTimes(5)
    expect(chunked.postMessage.mock.calls.map(([frame]) => Array.from(new Int16Array(frame.pcm))))
      .toEqual(contiguous.postMessage.mock.calls.map(([frame]) => Array.from(new Int16Array(frame.pcm))))
  })

  it('clips to signed little-endian PCM16 and computes levels from clipped samples', () => {
    const { processor, postMessage } = loadProcessor(16000)
    const input = Float32Array.from({ length: 320 }, (_, index) => index % 2 ? -2 : 2)
    processor.process([[input]])
    const frame = postMessage.mock.calls[0][0]
    expect(Array.from(new Uint8Array(frame.pcm).subarray(0, 4))).toEqual([255, 127, 0, 128])
    expect(frame.rms).toBe(1)
    expect(frame.peak).toBe(1)
  })

  it('retains partial frames through missing input and emits silence rather than suppressing quiet audio', () => {
    const { processor, postMessage } = loadProcessor(16000)
    expect(processor.process([])).toBe(true)
    processor.process([[new Float32Array(128)]])
    expect(processor.process([[]])).toBe(true)
    processor.process([[new Float32Array(128)]])
    expect(postMessage).not.toHaveBeenCalled()
    processor.process([[new Float32Array(64)]])
    const frame = postMessage.mock.calls[0][0]
    expect(frame.pcm.byteLength).toBe(640)
    expect(new Uint8Array(frame.pcm).every(value => value === 0)).toBe(true)
    expect(frame.rms).toBe(0)
    expect(frame.peak).toBe(0)
  })
})
