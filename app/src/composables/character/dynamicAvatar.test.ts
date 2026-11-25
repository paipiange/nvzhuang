import { afterEach, describe, expect, it, vi } from 'vitest'
import { avatarMouthForLevel, createDynamicAvatarRenderer, normalizeAvatarAudioLevel } from './dynamicAvatar'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('dynamicAvatar', () => {
  it('maps bounded audio levels to stable mouth shapes', () => {
    expect(normalizeAvatarAudioLevel(Number.POSITIVE_INFINITY)).toBe(0)
    expect(normalizeAvatarAudioLevel(-1)).toBe(0)
    expect(normalizeAvatarAudioLevel(2)).toBe(1)
    expect(avatarMouthForLevel(1, false)).toEqual({ openness: 0, shape: 'closed' })
    expect(avatarMouthForLevel(0, true).shape).toBe('small')
    expect(avatarMouthForLevel(0.1, true).shape).toBe('medium')
    expect(avatarMouthForLevel(1, true).shape).toBe('wide')
  })

  it('drives mouth, blink and body motion, then fully disposes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
    const avatar = createDynamicAvatarRenderer()
    await avatar.renderer.load('linxi-static')
    avatar.renderer.setExpression('speaking')
    avatar.renderer.feedAudioLevel(1)
    expect(avatar.runtimeMode.value).toBe('dynamic2d')
    expect(avatar.mouthShape.value).not.toBe('closed')
    vi.advanceTimersByTime(2500)
    expect(avatar.breath.value).not.toBe(0)
    expect(avatar.headTilt.value).not.toBe(0)
    avatar.renderer.dispose()
    expect([avatar.speaking.value, avatar.mouthShape.value, avatar.rms.value, avatar.breath.value]).toEqual([false, 'closed', 0, 0])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses reduced-motion mode and falls back safely for unknown models', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
    const avatar = createDynamicAvatarRenderer()
    expect(avatar.runtimeMode.value).toBe('reduced-motion')
    await expect(avatar.renderer.load('unknown')).rejects.toThrow('avatar_asset_missing')
    expect(avatar.runtimeMode.value).toBe('static-fallback')
    avatar.renderer.dispose()
  })
})
