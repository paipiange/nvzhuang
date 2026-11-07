<script setup lang="ts">
defineProps<{
  title: string
  imageUrl: string | null
  placeholderText: string
  actionText: string
  secondaryActionText?: string
  badgeText?: string
}>()

const emit = defineEmits<{
  (e: 'action'): void
  (e: 'secondaryAction'): void
  (e: 'clear'): void
}>()
</script>

<template>
  <view class="try-photo">
    <view class="try-top">
      {{ title }}
    </view>

    <!-- 图片展示 -->
    <image
      v-if="imageUrl"
      :src="imageUrl"
      mode="aspectFill"
      class="photo-img"
    />

    <!-- 空占位 -->
    <view v-else class="empty-placeholder" @tap="emit('action')">
      <view class="i-carbon-camera mb-2 text-28px text-#baa6aa" />
      <text class="placeholder-text">{{ placeholderText }}</text>
    </view>

    <!-- 底部操作按钮 -->
    <view class="try-bottom">
      <view class="btn-group">
        <view class="action-btn" @tap="emit('action')">
          <view :class="imageUrl ? 'i-carbon-renew' : 'i-carbon-add'" class="mr-1 text-12px" />
          <text>{{ actionText }}</text>
        </view>
        <view
          v-if="secondaryActionText"
          class="action-btn secondary"
          @tap="emit('secondaryAction')"
        >
          <text>{{ secondaryActionText }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.try-photo {
  height: 388rpx;
  flex: 1;
  min-width: 0;
  position: relative;
  border-radius: 26rpx;
  overflow: hidden;
  background: #eee5e1;
  border: 1px solid #ebdada;
}

.photo-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.empty-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20rpx;
  background: #f7f1ee;
}

.placeholder-text {
  font-size: 20rpx;
  color: #a49799;
  text-align: center;
}

.try-top {
  position: absolute;
  z-index: 3;
  top: 16rpx;
  left: 16rpx;
  font-size: 20rpx;
  font-weight: 700;
  color: #4d3b3d;
  background: rgba(255, 255, 255, 0.88);
  border-radius: 40rpx;
  padding: 8rpx 16rpx;
  backdrop-filter: blur(4px);
}

.try-bottom {
  position: absolute;
  z-index: 3;
  bottom: 16rpx;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  padding: 0 12rpx;
}

.btn-group {
  display: flex;
  gap: 10rpx;
}

.action-btn {
  display: flex;
  align-items: center;
  border-radius: 40rpx;
  background: rgba(255, 255, 255, 0.95);
  color: #454044;
  padding: 10rpx 18rpx;
  font-size: 20rpx;
  font-weight: 700;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.08);

  &.secondary {
    background: rgba(250, 240, 243, 0.95);
    color: #b86076;
  }

  &:active {
    transform: scale(0.96);
  }
}
</style>
