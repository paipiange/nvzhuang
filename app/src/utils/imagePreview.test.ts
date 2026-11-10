import { describe, expect, it, vi } from 'vitest'
import { computeContainSize, computePreviewCardSize, getViewportSize } from './imagePreview'

describe('imagePreview utils', () => {
  describe('computePreviewCardSize', () => {
    it('comfyUI 竖屏比例 (352x640) 在小屏手机上受可视高度约束，不溢出屏幕', () => {
      const result = computePreviewCardSize({
        viewportWidth: 360,
        viewportHeight: 640,
        imageWidth: 352,
        imageHeight: 640,
      })

      expect(result.containerWidth).toBe(328)
      expect(result.maxHeightPx).toBe(380)
      expect(result.heightPx).toBe(380)
      expect(result.isConstrainedByViewport).toBe(true)
    })

    it('主流手机 (390x844) 展示 2:3 竖图时自适应高度且不超上限', () => {
      const result = computePreviewCardSize({
        viewportWidth: 390,
        viewportHeight: 844,
        imageWidth: 1024,
        imageHeight: 1536,
      })

      expect(result.containerWidth).toBe(358)
      expect(result.maxHeightPx).toBe(523)
      expect(result.heightPx).toBe(523)
      expect(result.isConstrainedByViewport).toBe(true)
    })

    it('正方形 (1024x1024) 与横屏图 (1536x1024) 按原图比例收紧容器高度，避免多余留白', () => {
      const square = computePreviewCardSize({
        viewportWidth: 390,
        viewportHeight: 844,
        imageWidth: 1024,
        imageHeight: 1024,
      })
      expect(square.heightPx).toBe(358)
      expect(square.isConstrainedByViewport).toBe(false)

      const landscape = computePreviewCardSize({
        viewportWidth: 390,
        viewportHeight: 844,
        imageWidth: 1536,
        imageHeight: 1024,
      })
      expect(landscape.heightPx).toBe(239)
      expect(landscape.isConstrainedByViewport).toBe(false)
    })

    it('极窄横幅图也保持最小可读高度，避免水印遮挡画面', () => {
      const wide = computePreviewCardSize({
        viewportWidth: 390,
        viewportHeight: 844,
        imageWidth: 2048,
        imageHeight: 512,
      })

      expect(wide.heightPx).toBe(180)
    })

    it('桌面宽屏下容器宽度与高度上限均受控，不撑破页面', () => {
      const desktop = computePreviewCardSize({
        viewportWidth: 1440,
        viewportHeight: 900,
        imageWidth: 352,
        imageHeight: 640,
      })

      expect(desktop.containerWidth).toBe(520)
      expect(desktop.maxHeightPx).toBe(558)
      expect(desktop.heightPx).toBe(558)
      expect(desktop.isConstrainedByViewport).toBe(true)
    })

    it('未传入图片尺寸时使用默认 2:3 比例占位', () => {
      const placeholder = computePreviewCardSize({
        viewportWidth: 390,
        viewportHeight: 844,
      })

      expect(placeholder.aspectRatio).toBeCloseTo(2 / 3, 4)
      expect(placeholder.heightPx).toBe(523)
    })
  })

  describe('computeContainSize', () => {
    it('comfyUI 352x640 在手机端全屏预览时等比放大但严格不超出舞台宽高', () => {
      const size = computeContainSize({
        stageWidth: 390,
        stageHeight: 700,
        imageWidth: 352,
        imageHeight: 640,
      })

      expect(size.width).toBe(366)
      expect(size.height).toBe(665)
      expect(size.width).toBeLessThanOrEqual(366)
      expect(size.height).toBeLessThanOrEqual(680)
    })

    it('超长竖图 (720x1600) 按高度等比缩放至完整可见，不发生裁切', () => {
      const size = computeContainSize({
        stageWidth: 390,
        stageHeight: 700,
        imageWidth: 720,
        imageHeight: 1600,
      })

      expect(size.height).toBe(680)
      expect(size.width).toBe(306)
    })

    it('横图 (1536x1024) 在竖屏中按宽度完整适配', () => {
      const size = computeContainSize({
        stageWidth: 390,
        stageHeight: 700,
        imageWidth: 1536,
        imageHeight: 1024,
      })

      expect(size.width).toBe(366)
      expect(size.height).toBe(244)
    })

    it('桌面横屏中竖图按高度约束完整显示', () => {
      const size = computeContainSize({
        stageWidth: 1280,
        stageHeight: 680,
        imageWidth: 352,
        imageHeight: 640,
      })

      expect(size.height).toBe(660)
      expect(size.width).toBe(363)
    })

    it('未加载出宽高时返回安全舞台尺寸', () => {
      const size = computeContainSize({
        stageWidth: 390,
        stageHeight: 700,
      })

      expect(size.width).toBe(366)
      expect(size.height).toBe(680)
      expect(size.scaleToFit).toBe(1)
    })
  })

  describe('getViewportSize', () => {
    it('优先读取 uni.getSystemInfoSync 的窗口宽高', () => {
      vi.mocked(uni.getSystemInfoSync).mockReturnValueOnce({
        windowWidth: 412,
        windowHeight: 915,
      } as any)

      expect(getViewportSize()).toEqual({ width: 412, height: 915 })
    })
  })
})
