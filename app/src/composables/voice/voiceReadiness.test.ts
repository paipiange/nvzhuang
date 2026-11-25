import { describe, expect, it } from 'vitest'
import { evaluateVoiceReadiness } from './voiceReadiness'

describe('voice readiness', () => {
  it('blocks unsafe endpoints and offline calls', () => {
    const result = evaluateVoiceReadiness({ online: false, endpointValid: false, captureSupported: true, inputDetected: true, providerConfigured: true, microphoneTest: 'passed', speakerTest: 'passed' })
    expect(result.ready).toBe(false)
    expect(result.warningCount).toBe(2)
  })

  it('keeps missing labels and server configuration as actionable warnings', () => {
    const result = evaluateVoiceReadiness({ online: true, endpointValid: true, captureSupported: true, inputDetected: false, providerConfigured: false, microphoneTest: 'passed', speakerTest: 'passed' })
    expect(result.ready).toBe(true)
    expect(result.warningCount).toBe(2)
  })

  it('reports local audio tests as non-blocking reminders', () => {
    const result = evaluateVoiceReadiness({ online: true, endpointValid: true, captureSupported: true, inputDetected: true, providerConfigured: true, microphoneTest: 'failed', speakerTest: 'untested' })
    expect(result.ready).toBe(true)
    expect(result.warningCount).toBe(2)
    expect(result.checks.map(item => item.label)).toContain('麦克风试音需检查')
    expect(result.checks.map(item => item.label)).toContain('扬声器试音未执行')
  })
})
