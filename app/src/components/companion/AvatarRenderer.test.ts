import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AvatarRenderer from './AvatarRenderer.vue'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('avatarRenderer', () => {
  it('renders audio-driven mouth motion and releases its animation timer', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
    const wrapper = mount(AvatarRenderer, {
      props: {
        modelId: 'zhixia-static',
        faceSrc: '/static/test.webp',
        poseId: 'natural',
        outfitId: 'SPR-0001',
        outfitLibrary: 'real',
        speaking: true,
        audioLevel: 1,
      },
    })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('动态 2D · 音量嘴型')
    expect(wrapper.find('.avatar-mouth').exists()).toBe(true)
    expect(wrapper.find('.mouth-wide').exists()).toBe(true)
    expect(wrapper.attributes('style')).toContain('--mouth-open')
    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
