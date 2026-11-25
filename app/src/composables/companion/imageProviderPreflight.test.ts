import { describe, expect, it } from 'vitest'
import { evaluateImageProviderPreflight } from './imageProviderPreflight'

describe('imageProviderPreflight', () => {
  it('summarizes configured providers without accepting generation probes', () => {
    expect(evaluateImageProviderPreflight({
      code: 0,
      data: {
        generation_request_made: false,
        providers: [
          { alias: 'gemini', configured: true, reachable: true },
          { alias: 'comfyui', configured: true, reachable: false },
          { alias: 'doubao', configured: false, reachable: false },
        ],
      },
    })).toMatchObject({ ok: true, ready: 1, total: 3 })
  })

  it('rejects incompatible or billing-producing responses', () => {
    expect(evaluateImageProviderPreflight({ code: 0, data: { providers: [] } })).toMatchObject({ ok: false })
    expect(evaluateImageProviderPreflight({ code: 0, data: { generation_request_made: true, providers: [] } })).toMatchObject({ ok: false })
  })
})
