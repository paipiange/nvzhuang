import { describe, expect, it } from 'vitest'
import { evaluateVoiceBackendPreflight } from './voiceBackendPreflight'

describe('voiceBackendPreflight', () => {
  const status = { code: 0, data: { components: [], models: [] } }

  it('accepts a backend key or a memory-only runtime key without exposing either value', () => {
    expect(evaluateVoiceBackendPreflight(status, { code: 0, data: { seeduplex_api_key_configured: true } })).toMatchObject({ ok: true, configured: true })
    expect(evaluateVoiceBackendPreflight(status, { code: 0, data: { seeduplex_api_key_configured: false } }, true)).toMatchObject({ ok: true, configured: true })
  })

  it('rejects unrelated or incompatible endpoint responses', () => {
    expect(evaluateVoiceBackendPreflight({ code: 0, data: {} }, { code: 0, data: {} })).toMatchObject({ ok: false, configured: false })
  })
})
