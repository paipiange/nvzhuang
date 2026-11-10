<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, onUnmounted, ref, watch } from 'vue'
import { saveImageToAlbum } from '@/utils/platform'
import { computeContainSize, getViewportSize } from '@/utils/imagePreview'
import type { ImageDimensions, PreviewImageItem } from '@/utils/imagePreview'

const props = withDefaults(defineProps<{
  visible: boolean
  items: PreviewImageItem[]
  initialIndex?: number
  showSave?: boolean
}>(), {
  initialIndex: 0,
  showSave: true,
})

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'close'): void
}>()

const instance = getCurrentInstance()

function getFallbackStageSize() {
  const viewport = getViewportSize()
  return {
    width: viewport.width,
    height: Math.max(240, viewport.height - 176),
  }
}

const activeIndex = ref(0)
const zoomScale = ref<1 | 2>(1)
const scrollLeft = ref(0)
const scrollTop = ref(0)
const stageSize = ref(getFallbackStageSize())
const imageDimensions = ref<Record<number, ImageDimensions>>({})

let measureTimer: ReturnType<typeof setTimeout> | null = null
let resizeListenerBound = false
// #ifdef H5
let prevBodyOverflow = ''
let h5ListenersBound = false
// #endif

const safeItems = computed(() => (props.items || []).filter(item => Boolean(item?.url)))

const currentItem = computed(() => safeItems.value[activeIndex.value] || safeItems.value[0] || null)

const currentDimension = computed(() => imageDimensions.value[activeIndex.value] || null)

function clampIndex(idx: number) {
  const max = Math.max(0, safeItems.value.length - 1)
  return Math.min(Math.max(0, idx), max)
}

function resetZoom() {
  zoomScale.value = 1
  scrollLeft.value = 0
  scrollTop.value = 0
}

function handleClose() {
  resetZoom()
  emit('update:visible', false)
  emit('close')
}

function getContainDimensions(idx: number) {
  const dim = imageDimensions.value[idx]
  return computeContainSize({
    stageWidth: stageSize.value.width,
    stageHeight: stageSize.value.height,
    imageWidth: dim?.width,
    imageHeight: dim?.height,
    paddingX: 24,
    paddingY: 20,
  })
}

function getDisplayDimensions(idx: number) {
  const contain = getContainDimensions(idx)
  const scale = idx === activeIndex.value ? zoomScale.value : 1
  return {
    width: Math.round(contain.width * scale),
    height: Math.round(contain.height * scale),
  }
}

function getCanvasStyle(idx: number) {
  const display = getDisplayDimensions(idx)
  return {
    width: `${Math.max(stageSize.value.width, display.width)}px`,
    height: `${Math.max(stageSize.value.height, display.height)}px`,
  }
}

function getImageStyle(idx: number) {
  const display = getDisplayDimensions(idx)
  return {
    width: `${display.width}px`,
    height: `${display.height}px`,
  }
}

function measureStageSize() {
  const fallback = getFallbackStageSize()
  nextTick(() => {
    try {
      const query = instance?.proxy
        ? uni.createSelectorQuery().in(instance.proxy)
        : uni.createSelectorQuery()
      query
        .select('.preview-stage')
        .boundingClientRect((rect) => {
          const box = Array.isArray(rect) ? rect[0] : rect
          if (box && typeof box.width === 'number' && box.width > 0 && typeof box.height === 'number' && box.height > 0) {
            stageSize.value = {
              width: Math.round(box.width),
              height: Math.round(box.height),
            }
          }
          else {
            stageSize.value = fallback
          }
        })
        .exec()
    }
    catch {
      stageSize.value = fallback
    }
  })
}

function handleWindowResize() {
  if (props.visible) {
    measureStageSize()
  }
}

function handleImageLoad(idx: number, e: { detail?: { width?: number | string, height?: number | string } }) {
  const width = Number(e?.detail?.width)
  const height = Number(e?.detail?.height)
  if (width > 0 && height > 0) {
    imageDimensions.value = {
      ...imageDimensions.value,
      [idx]: { width, height },
    }
  }
}

function handleSwiperChange(e: { detail?: { current?: number } }) {
  const nextIdx = Number(e?.detail?.current)
  if (!Number.isNaN(nextIdx)) {
    activeIndex.value = clampIndex(nextIdx)
  }
  resetZoom()
}

function handleSelectSlide(idx: number) {
  activeIndex.value = clampIndex(idx)
  resetZoom()
}

function handleToggleZoom() {
  if (zoomScale.value > 1) {
    resetZoom()
    return
  }
  zoomScale.value = 2
  nextTick(() => {
    const display = getDisplayDimensions(activeIndex.value)
    scrollLeft.value = Math.max(0, Math.round((display.width - stageSize.value.width) / 2))
    scrollTop.value = Math.max(0, Math.round((display.height - stageSize.value.height) / 2))
  })
}

function handleBackdropTap() {
  if (zoomScale.value > 1) {
    resetZoom()
    return
  }
  handleClose()
}

function handleSaveCurrent() {
  if (!currentItem.value?.url) {
    return
  }
  saveImageToAlbum(currentItem.value.url)
}

function clearTimers() {
  if (measureTimer) {
    clearTimeout(measureTimer)
    measureTimer = null
  }
}

function bindResizeListener() {
  if (!resizeListenerBound && typeof uni.onWindowResize === 'function') {
    uni.onWindowResize(handleWindowResize)
    resizeListenerBound = true
  }
}

function unbindResizeListener() {
  if (resizeListenerBound && typeof uni.offWindowResize === 'function') {
    uni.offWindowResize(handleWindowResize)
    resizeListenerBound = false
  }
}

// #ifdef H5
function handleH5Keydown(e: KeyboardEvent) {
  if (!props.visible) {
    return
  }
  if (e.key === 'Escape') {
    handleClose()
  }
  else if (e.key === 'ArrowLeft' && zoomScale.value === 1 && safeItems.value.length > 1) {
    activeIndex.value = clampIndex(activeIndex.value - 1)
  }
  else if (e.key === 'ArrowRight' && zoomScale.value === 1 && safeItems.value.length > 1) {
    activeIndex.value = clampIndex(activeIndex.value + 1)
  }
}

function bindH5Effects() {
  if (typeof document !== 'undefined') {
    prevBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  if (!h5ListenersBound && typeof window !== 'undefined') {
    window.addEventListener('keydown', handleH5Keydown)
    h5ListenersBound = true
  }
}

function unbindH5Effects() {
  if (typeof document !== 'undefined') {
    document.body.style.overflow = prevBodyOverflow
  }
  if (h5ListenersBound && typeof window !== 'undefined') {
    window.removeEventListener('keydown', handleH5Keydown)
    h5ListenersBound = false
  }
}
// #endif

watch(
  () => props.visible,
  (isVisible) => {
    clearTimers()
    if (isVisible) {
      activeIndex.value = clampIndex(props.initialIndex)
      resetZoom()
      stageSize.value = getFallbackStageSize()
      bindResizeListener()
      // #ifdef H5
      bindH5Effects()
      // #endif
      measureStageSize()
      measureTimer = setTimeout(measureStageSize, 60)
    }
    else {
      unbindResizeListener()
      // #ifdef H5
      unbindH5Effects()
      // #endif
    }
  },
  { immediate: true },
)

watch(
  () => props.initialIndex,
  (idx) => {
    if (props.visible) {
      activeIndex.value = clampIndex(idx)
      resetZoom()
    }
  },
)

watch(
  safeItems,
  () => {
    imageDimensions.value = {}
    activeIndex.value = clampIndex(activeIndex.value)
  },
)

onUnmounted(() => {
  clearTimers()
  unbindResizeListener()
  // #ifdef H5
  unbindH5Effects()
  // #endif
})
</script>

<template>
  <view v-if="visible && safeItems.length > 0" class="preview-overlay">
    <!-- 顶部栏 -->
    <view class="preview-header pt-safe">
      <view class="header-left">
        <text class="index-pill">{{ activeIndex + 1 }} / {{ safeItems.length }}</text>
        <text v-if="currentItem?.label" class="label-pill">{{ currentItem.label }}</text>
      </view>
      <view class="header-actions">
        <view class="header-btn" @tap="handleToggleZoom">
          <view :class="zoomScale > 1 ? 'i-carbon-zoom-out' : 'i-carbon-zoom-in'" class="text-15px text-white" />
          <text class="header-btn-text">{{ zoomScale > 1 ? '1x' : '2x' }}</text>
        </view>
        <view class="header-btn close-btn" @tap="handleClose">
          <view class="i-carbon-close text-18px text-white" />
        </view>
      </view>
    </view>

    <!-- 中央自适应预览舞台 -->
    <view class="preview-stage">
      <swiper
        class="stage-swiper"
        :style="{ height: `${stageSize.height}px` }"
        :current="activeIndex"
        :duration="240"
        :disable-touch="zoomScale > 1"
        @change="handleSwiperChange"
      >
        <swiper-item
          v-for="(item, idx) in safeItems"
          :key="`${idx}-${item.url}`"
          class="stage-slide"
        >
          <scroll-view
            class="stage-scroll"
            :scroll-x="zoomScale > 1"
            :scroll-y="zoomScale > 1"
            :scroll-left="idx === activeIndex ? scrollLeft : 0"
            :scroll-top="idx === activeIndex ? scrollTop : 0"
          >
            <view
              class="stage-canvas"
              :style="getCanvasStyle(idx)"
              @tap="handleBackdropTap"
            >
              <image
                :src="item.url"
                mode="aspectFit"
                class="stage-image"
                :style="getImageStyle(idx)"
                @load="handleImageLoad(idx, $event)"
                @tap.stop="handleToggleZoom"
              />
            </view>
          </scroll-view>
        </swiper-item>
      </swiper>
    </view>

    <!-- 底部控制栏 -->
    <view class="preview-footer pb-safe">
      <view v-if="safeItems.length > 1" class="switch-tabs">
        <view
          v-for="(item, idx) in safeItems"
          :key="`tab-${idx}-${item.url}`"
          class="switch-tab"
          :class="{ active: idx === activeIndex }"
          @tap="handleSelectSlide(idx)"
        >
          <text>{{ item.label || `图片 ${idx + 1}` }}</text>
        </view>
      </view>

      <view class="footer-bar">
        <text class="footer-hint">
          {{ currentDimension ? `${currentDimension.width}×${currentDimension.height} · ` : '' }}{{ zoomScale > 1 ? '拖动查看细节，轻触图片还原' : '已自适应屏幕，轻触图片可放大' }}
        </text>
        <view class="footer-actions">
          <view class="footer-btn secondary" @tap="handleToggleZoom">
            <view :class="zoomScale > 1 ? 'i-carbon-minimize' : 'i-carbon-maximize'" class="text-14px" />
            <text>{{ zoomScale > 1 ? '适应屏幕' : '放大查看' }}</text>
          </view>
          <view v-if="showSave" class="footer-btn primary" @tap="handleSaveCurrent">
            <view class="i-carbon-download text-14px" />
            <text>保存</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(15, 12, 14, 0.96);
  display: flex;
  flex-direction: column;
  overscroll-behavior: contain;
}

.preview-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18rpx 28rpx 12rpx;
  z-index: 2;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.index-pill {
  font-size: 22rpx;
  font-weight: 700;
  color: #ffffff;
  background: rgba(255, 255, 255, 0.14);
  padding: 6rpx 16rpx;
  border-radius: 999rpx;
}

.label-pill {
  font-size: 22rpx;
  font-weight: 600;
  color: #f8dce2;
  background: rgba(205, 113, 136, 0.28);
  border: 1px solid rgba(205, 113, 136, 0.45);
  padding: 6rpx 16rpx;
  border-radius: 999rpx;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.header-btn {
  height: 60rpx;
  padding: 0 18rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.14);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6rpx;

  &:active {
    opacity: 0.8;
  }
}

.close-btn {
  width: 60rpx;
  padding: 0;
}

.header-btn-text {
  font-size: 20rpx;
  font-weight: 600;
  color: #ffffff;
}

.preview-stage {
  flex: 1;
  min-height: 0;
  width: 100%;
  position: relative;
  overflow: hidden;
}

.stage-swiper {
  width: 100%;
  height: 100%;
}

.stage-slide {
  width: 100%;
  height: 100%;
}

.stage-scroll {
  width: 100%;
  height: 100%;
}

.stage-canvas {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.stage-image {
  display: block;
  object-fit: contain;
  border-radius: 6px;
  transition:
    width 0.18s ease,
    height 0.18s ease;
}

.preview-footer {
  flex-shrink: 0;
  padding: 12rpx 28rpx 22rpx;
  display: flex;
  flex-direction: column;
  gap: 14rpx;
  background: linear-gradient(180deg, rgba(15, 12, 14, 0) 0%, rgba(15, 12, 14, 0.92) 28%);
}

.switch-tabs {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  flex-wrap: wrap;
}

.switch-tab {
  font-size: 20rpx;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.72);
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.14);
  padding: 8rpx 20rpx;
  border-radius: 999rpx;

  &.active {
    color: #ffffff;
    background: #cd7188;
    border-color: #cd7188;
  }
}

.footer-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14rpx;
  flex-wrap: wrap;
}

.footer-hint {
  flex: 1;
  min-width: 160px;
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.65);
}

.footer-actions {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.footer-btn {
  display: inline-flex;
  align-items: center;
  gap: 6rpx;
  padding: 12rpx 22rpx;
  border-radius: 999rpx;
  font-size: 20rpx;
  font-weight: 600;

  &.secondary {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.14);
  }

  &.primary {
    color: #ffffff;
    background: #cd7188;
  }

  &:active {
    opacity: 0.85;
  }
}
</style>
