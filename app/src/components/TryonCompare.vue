<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { saveImageToAlbum } from '@/utils/platform'
import { computePreviewCardSize, getViewportSize } from '@/utils/imagePreview'
import type { ImageDimensions, PreviewImageItem } from '@/utils/imagePreview'
import ImagePreviewModal from '@/components/ImagePreviewModal.vue'

const props = defineProps<{
  personUrl: string | null
  garmentUrl: string | null
  resultUrl: string
  modelName?: string
}>()

const instance = getCurrentInstance()
const viewport = ref(getViewportSize())
const measuredWidth = ref<number | undefined>(undefined)
const naturalSize = ref<ImageDimensions | undefined>(undefined)
const previewVisible = ref(false)
const previewIndex = ref(0)

let resizeListenerBound = false

const previewItems = computed<PreviewImageItem[]>(() => {
  const list: PreviewImageItem[] = []
  if (props.resultUrl) {
    list.push({ url: props.resultUrl, label: '换装结果' })
  }
  if (props.personUrl) {
    list.push({ url: props.personUrl, label: '原人像' })
  }
  if (props.garmentUrl) {
    list.push({ url: props.garmentUrl, label: '原服装' })
  }
  return list
})

const cardSize = computed(() => {
  return computePreviewCardSize({
    viewportWidth: viewport.value.width,
    viewportHeight: viewport.value.height,
    containerWidth: measuredWidth.value,
    imageWidth: naturalSize.value?.width,
    imageHeight: naturalSize.value?.height,
  })
})

const largeBoxStyle = computed(() => ({
  height: `${cardSize.value.heightPx}px`,
}))

function measureContainerWidth() {
  viewport.value = getViewportSize()
  nextTick(() => {
    try {
      const query = instance?.proxy
        ? uni.createSelectorQuery().in(instance.proxy)
        : uni.createSelectorQuery()
      query
        .select('.result-large-box')
        .boundingClientRect((rect) => {
          const box = Array.isArray(rect) ? rect[0] : rect
          if (box && typeof box.width === 'number' && box.width > 0) {
            measuredWidth.value = box.width
          }
        })
        .exec()
    }
    catch {
      // 回退至 computePreviewCardSize 内置宽度估算
    }
  })
}

function handleMainImageLoad(e: { detail?: { width?: number | string, height?: number | string } }) {
  const width = Number(e?.detail?.width)
  const height = Number(e?.detail?.height)
  if (width > 0 && height > 0) {
    naturalSize.value = { width, height }
  }
  measureContainerWidth()
}

function handleSave() {
  saveImageToAlbum(props.resultUrl)
}

function openPreviewByLabel(label: string) {
  const idx = previewItems.value.findIndex(item => item.label === label)
  previewIndex.value = idx >= 0 ? idx : 0
  previewVisible.value = true
}

watch(
  () => props.resultUrl,
  () => {
    naturalSize.value = undefined
    measureContainerWidth()
  },
)

onMounted(() => {
  measureContainerWidth()
  if (typeof uni.onWindowResize === 'function') {
    uni.onWindowResize(measureContainerWidth)
    resizeListenerBound = true
  }
})

onUnmounted(() => {
  if (resizeListenerBound && typeof uni.offWindowResize === 'function') {
    uni.offWindowResize(measureContainerWidth)
    resizeListenerBound = false
  }
})
</script>

<template>
  <view class="compare-card">
    <view class="result-large-box" :style="largeBoxStyle" @tap="openPreviewByLabel('换装结果')">
      <image
        :src="resultUrl"
        mode="aspectFit"
        class="result-main-img"
        @load="handleMainImageLoad"
      />
      <view class="zoom-badge">
        <view class="i-carbon-maximize text-11px text-white" />
        <text>全屏预览</text>
      </view>
      <view class="watermark-tag">
        ✦ AI 换装生成效果 · {{ modelName || '拍片哥女装' }}
      </view>
    </view>

    <!-- 底部小图对比 -->
    <view class="source-row">
      <view v-if="personUrl" class="thumb-box" @tap="openPreviewByLabel('原人像')">
        <image :src="personUrl" mode="aspectFill" class="thumb-img" />
        <text class="thumb-label">原人像</text>
      </view>
      <view class="compare-plus">
        +
      </view>
      <view v-if="garmentUrl" class="thumb-box" @tap="openPreviewByLabel('原服装')">
        <image :src="garmentUrl" mode="aspectFill" class="thumb-img" />
        <text class="thumb-label">原服装</text>
      </view>
      <view class="compare-arrow">
        →
      </view>
      <view class="save-box" @tap="handleSave">
        <view class="i-carbon-download mb-1 text-16px text-#cd7188" />
        <text class="save-label">保存到相册</text>
      </view>
    </view>

    <ImagePreviewModal
      v-model:visible="previewVisible"
      :items="previewItems"
      :initial-index="previewIndex"
    />
  </view>
</template>

<style scoped lang="scss">
.compare-card {
  background: #ffffff;
  border-radius: 28rpx;
  overflow: hidden;
  border: 1px solid #ebdada;
  box-shadow: 0 10rpx 28rpx rgba(47, 35, 38, 0.06);
}

.result-large-box {
  width: 100%;
  min-height: 180px;
  position: relative;
  background: #f7eff1;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: height 0.2s ease;
}

.result-main-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.zoom-badge {
  position: absolute;
  top: 16rpx;
  right: 16rpx;
  font-size: 18rpx;
  color: #ffffff;
  background: rgba(39, 34, 37, 0.56);
  border-radius: 999rpx;
  padding: 6rpx 14rpx;
  display: flex;
  align-items: center;
  gap: 6rpx;
  backdrop-filter: blur(4px);
}

.watermark-tag {
  position: absolute;
  bottom: 16rpx;
  right: 16rpx;
  font-size: 18rpx;
  color: #ffffff;
  background: rgba(39, 34, 37, 0.65);
  border-radius: 30rpx;
  padding: 6rpx 16rpx;
  backdrop-filter: blur(4px);
}

.source-row {
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: 20rpx 16rpx;
  background: #faf7f7;
  border-top: 1px solid #f0e6e8;
}

.thumb-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 110rpx;
  cursor: pointer;

  &:active {
    opacity: 0.85;
  }
}

.thumb-img {
  width: 90rpx;
  height: 120rpx;
  border-radius: 12rpx;
  object-fit: cover;
  border: 1px solid #eee;
}

.thumb-label {
  font-size: 18rpx;
  color: #8c7e81;
  margin-top: 6rpx;
}

.compare-plus,
.compare-arrow {
  font-size: 24rpx;
  color: #b59fa3;
  font-weight: 700;
}

.save-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 140rpx;
  height: 120rpx;
  background: #fcecef;
  border-radius: 16rpx;
  cursor: pointer;

  &:active {
    opacity: 0.85;
  }
}

.save-label {
  font-size: 18rpx;
  color: #cd7188;
  font-weight: 700;
}
</style>
