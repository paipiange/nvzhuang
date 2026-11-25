import { describe, expect, it } from 'vitest'
import { normalizeModelBaseUrl, normalizeServiceBaseUrl } from './serviceEndpoint'

describe('normalizeServiceBaseUrl', () => {
  it('allows HTTPS services and controlled local development addresses', () => {
    expect(normalizeServiceBaseUrl(' https://api.example.com/base/ ')).toBe('https://api.example.com/base')
    expect(normalizeServiceBaseUrl('http://127.0.0.1:8000/')).toBe('http://127.0.0.1:8000')
    expect(normalizeServiceBaseUrl('http://10.0.2.2:8000')).toBe('http://10.0.2.2:8000')
  })

  it('rejects cleartext remote services and URL-carried data', () => {
    for (const value of ['http://api.example.com', 'https://user:pass@example.com', 'https://api.example.com?token=x', 'https://api.example.com/#private'])
      expect(() => normalizeServiceBaseUrl(value)).toThrow()
  })

  it('applies the same transport boundary to client model endpoints', () => {
    expect(normalizeModelBaseUrl('https://models.example.com/v1/')).toBe('https://models.example.com/v1')
    expect(() => normalizeModelBaseUrl('http://models.example.com/v1')).toThrow('模型端点')
    expect(() => normalizeModelBaseUrl('https://user:pass@models.example.com/v1')).toThrow('模型端点')
  })
})
