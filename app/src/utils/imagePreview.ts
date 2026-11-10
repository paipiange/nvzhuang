export interface ViewportSize {
  width: number
  height: number
}

export interface ImageDimensions {
  width: number
  height: number
}

export interface PreviewImageItem {
  url: string
  label?: string
}

export interface PreviewCardSizeOptions {
  viewportWidth: number
  viewportHeight: number
  containerWidth?: number
  imageWidth?: number
  imageHeight?: number
  defaultAspectRatio?: number
  minHeightPx?: number
  maxHeightRatio?: number
  reservedVerticalPx?: number
  maxHeightPx?: number
}

export interface PreviewCardSizeResult {
  containerWidth: number
  heightPx: number
  maxHeightPx: number
  aspectRatio: number
  isConstrainedByViewport: boolean
}

export interface ContainSizeOptions {
  stageWidth: number
  stageHeight: number
  imageWidth?: number
  imageHeight?: number
  paddingX?: number
  paddingY?: number
}

export interface ContainSizeResult {
  width: number
  height: number
  scaleToFit: number
}

const DEFAULT_VIEWPORT_WIDTH = 375
const DEFAULT_VIEWPORT_HEIGHT = 667

function isPositiveFinite(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val) && val > 0
}

/**
 * 获取当前窗口可视区域尺寸（像素）
 */
export function getViewportSize(): ViewportSize {
  try {
    const info = uni.getSystemInfoSync?.()
    if (info && isPositiveFinite(info.windowWidth) && isPositiveFinite(info.windowHeight)) {
      return {
        width: info.windowWidth,
        height: info.windowHeight,
      }
    }
  }
  catch {
    // 忽略运行时获取失败，继续兜底
  }

  if (typeof window !== 'undefined' && isPositiveFinite(window.innerWidth) && isPositiveFinite(window.innerHeight)) {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
    }
  }

  return {
    width: DEFAULT_VIEWPORT_WIDTH,
    height: DEFAULT_VIEWPORT_HEIGHT,
  }
}

/**
 * 计算换装结果对比卡片主图容器的自适应高度：
 * - 依据原图宽高比尽量完整铺开，避免固定高度造成大面积留白或 aspectFill 裁切
 * - 严格受当前屏幕可视高度约束，确保超长竖图（如 ComfyUI 352x640 / 9:16）也能一屏看到底部操作区
 */
export function computePreviewCardSize(options: PreviewCardSizeOptions): PreviewCardSizeResult {
  const viewportWidth = isPositiveFinite(options.viewportWidth) ? options.viewportWidth : DEFAULT_VIEWPORT_WIDTH
  const viewportHeight = isPositiveFinite(options.viewportHeight) ? options.viewportHeight : DEFAULT_VIEWPORT_HEIGHT

  const containerWidth = isPositiveFinite(options.containerWidth)
    ? options.containerWidth
    : Math.max(200, Math.min(viewportWidth - 32, 520))

  const defaultAspectRatio = isPositiveFinite(options.defaultAspectRatio) ? options.defaultAspectRatio : 2 / 3
  const hasNaturalSize = isPositiveFinite(options.imageWidth) && isPositiveFinite(options.imageHeight)
  const aspectRatio = hasNaturalSize
    ? options.imageWidth! / options.imageHeight!
    : defaultAspectRatio

  const minHeightPx = isPositiveFinite(options.minHeightPx) ? options.minHeightPx : 180
  const maxHeightRatio = isPositiveFinite(options.maxHeightRatio) ? options.maxHeightRatio : 0.62
  const reservedVerticalPx = isPositiveFinite(options.reservedVerticalPx) ? options.reservedVerticalPx : 260
  const absoluteMaxHeightPx = isPositiveFinite(options.maxHeightPx) ? options.maxHeightPx : 560

  const byRatio = Math.round(viewportHeight * maxHeightRatio)
  const byReserved = Math.round(viewportHeight - reservedVerticalPx)
  const maxHeightPx = Math.max(
    minHeightPx,
    Math.min(byRatio, byReserved > 0 ? byReserved : byRatio, absoluteMaxHeightPx),
  )

  const naturalHeight = Math.round(containerWidth / aspectRatio)
  const heightPx = Math.max(minHeightPx, Math.min(naturalHeight, maxHeightPx))

  return {
    containerWidth: Math.round(containerWidth),
    heightPx,
    maxHeightPx,
    aspectRatio,
    isConstrainedByViewport: naturalHeight > maxHeightPx,
  }
}

/**
 * 计算全屏预览弹窗中图片在舞台区域内等比完整显示（contain / aspectFit）的像素尺寸。
 * 保证任意分辨率（含 ComfyUI 超竖图、超宽横图）在默认 1x 状态下完整落入当前屏幕，不裁切、不溢出。
 */
export function computeContainSize(options: ContainSizeOptions): ContainSizeResult {
  const paddingX = options.paddingX ?? 24
  const paddingY = options.paddingY ?? 20
  const rawStageWidth = isPositiveFinite(options.stageWidth) ? options.stageWidth : DEFAULT_VIEWPORT_WIDTH
  const rawStageHeight = isPositiveFinite(options.stageHeight) ? options.stageHeight : DEFAULT_VIEWPORT_HEIGHT

  const safeStageWidth = Math.max(120, Math.round(rawStageWidth - paddingX))
  const safeStageHeight = Math.max(120, Math.round(rawStageHeight - paddingY))

  if (!isPositiveFinite(options.imageWidth) || !isPositiveFinite(options.imageHeight)) {
    return {
      width: safeStageWidth,
      height: safeStageHeight,
      scaleToFit: 1,
    }
  }

  const scaleToFit = Math.min(safeStageWidth / options.imageWidth, safeStageHeight / options.imageHeight)
  const width = Math.max(1, Math.round(options.imageWidth * scaleToFit))
  const height = Math.max(1, Math.round(options.imageHeight * scaleToFit))

  return {
    width,
    height,
    scaleToFit,
  }
}
