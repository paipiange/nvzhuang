import { describe, expect, it } from 'vitest'
import { requiresCloudCostAcknowledgement } from './cloudCostGuard'

describe('cloudCostGuard', () => {
  it('requires acknowledgement for cloud providers', () => {
    expect(requiresCloudCostAcknowledgement('gemini')).toBe(true)
    expect(requiresCloudCostAcknowledgement('gpt-image')).toBe(true)
    expect(requiresCloudCostAcknowledgement('custom-cloud')).toBe(true)
  })

  it('does not block mock or local ComfyUI generation', () => {
    expect(requiresCloudCostAcknowledgement('comfyui')).toBe(false)
    expect(requiresCloudCostAcknowledgement('comfyui-h3')).toBe(false)
    expect(requiresCloudCostAcknowledgement('gemini', true)).toBe(false)
  })
})
