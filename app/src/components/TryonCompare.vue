<script setup lang="ts">
import { saveImageToAlbum } from '@/utils/platform'

const props = defineProps<{
  personUrl: string | null
  garmentUrl: string | null
  resultUrl: string
  modelName?: string
}>()

function handleSave() {
  saveImageToAlbum(props.resultUrl)
}

function handlePreview() {
  uni.previewImage({
    current: props.resultUrl,
    urls: [props.resultUrl, props.personUrl, props.garmentUrl].filter(Boolean) as string[],
  })
}
</script>

<template>
  <view class="compare-card">
    <view class="result-large-box" @tap="handlePreview">
      <image :src="resultUrl" mode="aspectFill" class="result-main-img" />
      <view class="watermark-tag">
        ✦ AI 换装生成效果 · {{ modelName || '拍片哥女装' }}
      </view>
    </view>

    <!-- 底部小图对比 -->
    <view class="source-row">
      <view v-if="personUrl" class="thumb-box">
        <image :src="personUrl" mode="aspectFill" class="thumb-img" />
        <text class="thumb-label">原人像</text>
      </view>
      <view class="compare-plus">
        +
      </view>
      <view v-if="garmentUrl" class="thumb-box">
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
  height: 640rpx;
  position: relative;
  background: #f7eff1;
  overflow: hidden;
}

.result-main-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
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
