import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import ImagePreviewModal from './ImagePreviewModal.vue'
import TryonCompare from './TryonCompare.vue'

const uniElementStubs = {
  'scroll-view': { template: '<div class="uni-scroll-view-stub"><slot /></div>' },
  'swiper': { template: '<div class="uni-swiper-stub"><slot /></div>' },
  'swiper-item': { template: '<div class="uni-swiper-item-stub"><slot /></div>' },
}

async function dispatchImageLoad(imgWrapper: { element: Element }, width: number, height: number) {
  imgWrapper.element.dispatchEvent(new CustomEvent('load', {
    detail: { width, height },
  }))
  await nextTick()
}

describe('tryonCompare & ImagePreviewModal', () => {
  const originalCreateSelectorQuery = (uni as any).createSelectorQuery

  beforeEach(() => {
    vi.mocked(uni.getSystemInfoSync).mockReturnValue({
      platform: 'devtools',
      windowWidth: 390,
      windowHeight: 844,
    } as any)

    ;(uni as any).createSelectorQuery = vi.fn(() => {
      const api = {
        in: () => api,
        select: (selector: string) => ({
          boundingClientRect: (cb: (rect: { width: number, height: number }) => void) => {
            if (selector === '.preview-stage') {
              cb({ width: 390, height: 640 })
            }
            else {
              cb({ width: 358, height: 500 })
            }
            return api
          },
        }),
        exec: vi.fn(),
      }
      return api
    })
  })

  afterEach(() => {
    ;(uni as any).createSelectorQuery = originalCreateSelectorQuery
  })

  it('tryonCompare 使用 aspectFit 且根据 ComfyUI 图片比例自适应卡片高度', async () => {
    const wrapper = mount(TryonCompare, {
      props: {
        resultUrl: 'data:image/png;base64,result',
        personUrl: 'https://example.com/person.jpg',
        garmentUrl: 'https://example.com/garment.jpg',
        modelName: 'comfyui',
      },
      global: {
        stubs: uniElementStubs,
      },
    })

    const mainImg = wrapper.find('.result-main-img')
    expect(mainImg.attributes('mode')).toBe('aspectFit')

    // ComfyUI 竖屏比例 352x640：受屏幕高度限制为 523px，完整显示不溢出
    await dispatchImageLoad(mainImg, 352, 640)
    expect(wrapper.find('.result-large-box').attributes('style')).toContain('height: 523px')

    // 横屏图 1536x1024：容器自适应收紧为 239px，不留多余空白
    await dispatchImageLoad(mainImg, 1536, 1024)
    expect(wrapper.find('.result-large-box').attributes('style')).toContain('height: 239px')

    wrapper.unmount()
  })

  it('点击主图或对比缩略图可打开全屏自适应预览并定位对应图片', async () => {
    const wrapper = mount(TryonCompare, {
      props: {
        resultUrl: 'data:image/png;base64,result',
        personUrl: 'https://example.com/person.jpg',
        garmentUrl: 'https://example.com/garment.jpg',
      },
      global: {
        stubs: uniElementStubs,
      },
    })

    await wrapper.find('.result-large-box').trigger('tap')
    await nextTick()
    let modal = wrapper.findComponent(ImagePreviewModal)
    expect(modal.props('visible')).toBe(true)
    expect(modal.props('initialIndex')).toBe(0)

    await modal.find('.close-btn').trigger('tap')
    await nextTick()
    expect(modal.props('visible')).toBe(false)

    const thumbs = wrapper.findAll('.thumb-box')
    await thumbs[0].trigger('tap')
    await nextTick()
    modal = wrapper.findComponent(ImagePreviewModal)
    expect(modal.props('visible')).toBe(true)
    expect(modal.props('initialIndex')).toBe(1)

    await thumbs[1].trigger('tap')
    await nextTick()
    expect(modal.props('initialIndex')).toBe(2)

    wrapper.unmount()
  })

  it('imagePreviewModal 严格按屏幕舞台 contain 等比缩放并支持 1x/2x 切换', async () => {
    const wrapper = mount(ImagePreviewModal, {
      props: {
        visible: true,
        initialIndex: 0,
        items: [
          { url: 'data:image/png;base64,result', label: '换装结果' },
          { url: 'https://example.com/person.jpg', label: '原人像' },
        ],
      },
      global: {
        stubs: uniElementStubs,
      },
    })

    await nextTick()
    const stageImage = wrapper.findAll('.stage-image')[0]
    expect(stageImage.attributes('mode')).toBe('aspectFit')

    await dispatchImageLoad(stageImage, 352, 640)

    // stage=390x640, padding=(24,20) => 可用 366x620, 352x640 等比缩放到 341x620
    expect(stageImage.attributes('style')).toContain('width: 341px')
    expect(stageImage.attributes('style')).toContain('height: 620px')
    expect(wrapper.text()).toContain('352×640')

    // 点击图片放大 2x
    await stageImage.trigger('tap')
    await nextTick()
    expect(stageImage.attributes('style')).toContain('width: 682px')
    expect(stageImage.attributes('style')).toContain('height: 1240px')
    expect(wrapper.find('.stage-swiper').attributes('disable-touch')).toBe('true')

    // 再次点击还原 1x
    await stageImage.trigger('tap')
    await nextTick()
    expect(stageImage.attributes('style')).toContain('width: 341px')
    expect(stageImage.attributes('style')).toContain('height: 620px')

    wrapper.unmount()
  })
})
