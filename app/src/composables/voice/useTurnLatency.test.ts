import { describe, expect, it } from 'vitest'
import { useTurnLatency } from './useTurnLatency'

describe('useTurnLatency', () => {
  it('tracks connection and first-event latency for the active turn', () => {
    const latency = useTurnLatency()
    latency.note({ type: 'connect.started', at: 100 })
    latency.note({ type: 'session.ready', at: 340 })
    latency.note({ type: 'turn.started', at: 1000, turnId: 'turn-a' })
    latency.note({ type: 'transcript.first', at: 1250, turnId: 'turn-a' })
    latency.note({ type: 'transcript.first', at: 1500, turnId: 'turn-a' })
    latency.note({ type: 'audio.first', at: 1800, turnId: 'turn-a' })
    latency.note({ type: 'turn.completed', at: 2400, turnId: 'turn-a' })
    expect(latency.metrics.value).toEqual({ connectMs: 240, firstTranscriptMs: 250, firstAudioMs: 800, turnCompleteMs: 1400 })
  })

  it('ignores stale turns and resets bounded metrics', () => {
    const latency = useTurnLatency()
    latency.note({ type: 'turn.started', at: 1000, turnId: 'new' })
    latency.note({ type: 'audio.first', at: 900_000, turnId: 'old' })
    latency.note({ type: 'audio.first', at: 900_000, turnId: 'new' })
    expect(latency.metrics.value.firstAudioMs).toBe(300_000)
    latency.reset()
    expect(latency.metrics.value).toEqual({ connectMs: null, firstTranscriptMs: null, firstAudioMs: null, turnCompleteMs: null })
  })
})
