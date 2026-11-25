import { describe, expect, it } from 'vitest'
import { createDiagnosticReport } from './diagnosticReport'

const input = {
  provider: 'seeduplex' as const,
  characterId: 'linxi',
  online: true,
  reconnectStatus: 'scheduled',
  reconnectAttempt: 2,
  voiceState: 'idle',
  duplexState: 'listening',
  duplexErrorCode: 'audio_backpressure',
  quality: { grade: 'good', durationSeconds: 120, reconnects: 1, congestionEvents: 2 },
  latency: { connectMs: 240, firstTranscriptMs: 250, firstAudioMs: 800, turnCompleteMs: 1400 },
  readiness: [{ key: 'network', ok: true, blocking: true }],
  audio: { inputAvailable: true, outputAvailable: true, echoCancellation: true },
  localData: { transcripts: 12, presets: 3, portraitQueue: 1, portraitHistory: 4 },
  events: [{ at: 100, type: 'session.ready' }],
  toolCalls: [{ at: 120, source: 'voice-intent', name: 'change_pose', status: 'applied', code: 'ok' }],
}

describe('createDiagnosticReport', () => {
  it('returns reproducible bounded diagnostics', () => {
    expect(createDiagnosticReport(input, Date.parse('2026-11-22T00:00:00Z'))).toEqual({
      version: 1,
      generatedAt: '2026-11-22T00:00:00.000Z',
      provider: 'seeduplex',
      characterId: 'linxi',
      connection: { online: true, reconnectStatus: 'scheduled', reconnectAttempt: 2, voiceState: 'idle', duplexState: 'listening', duplexErrorCode: 'audio_backpressure' },
      quality: { grade: 'good', durationSeconds: 120, reconnects: 1, congestionEvents: 2 },
      latency: { connectMs: 240, firstTranscriptMs: 250, firstAudioMs: 800, turnCompleteMs: 1400 },
      readiness: [{ key: 'network', ok: true, blocking: true }],
      audio: { inputAvailable: true, outputAvailable: true, echoCancellation: true, noiseSuppression: null, autoGainControl: null },
      localData: { transcripts: 12, presets: 3, portraitQueue: 1, portraitHistory: 4 },
      events: [{ at: 100, type: 'session.ready' }],
      toolCalls: [{ at: 120, source: 'voice-intent', name: 'change_pose', status: 'applied', code: 'ok' }],
    })
  })

  it('drops extra private fields and normalizes unsafe strings and counts', () => {
    const report = createDiagnosticReport({
      ...input,
      characterId: '../private',
      reconnectStatus: 'https://private.invalid/?token=secret',
      reconnectAttempt: Number.POSITIVE_INFINITY,
      toolCalls: [{ at: 0, source: 'https://private.invalid', name: 'open_url', status: 'private conversation', code: 'token=secret' }],
      apiKey: 'must-not-survive',
      transcript: 'private conversation',
    } as typeof input, 0)
    const serialized = JSON.stringify(report)
    expect(serialized).not.toMatch(/secret|private conversation|private\.invalid|apiKey/)
    expect(report.characterId).toBe('unknown')
    expect(report.connection.reconnectAttempt).toBe(0)
  })
})
