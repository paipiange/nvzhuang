<script setup lang="ts">
defineProps<{
  title?: string
  description?: string
  actionText?: string
  icon?: string
}>()

const emit = defineEmits<{
  (e: 'action'): void
}>()
</script>

<template>
  <view class="empty-wrap">
    <view class="empty-icon-box">
      <view :class="icon || 'i-carbon-image'" class="text-36px text-#c8b8bb" />
    </view>
    <view class="empty-title">
      {{ title || '暂无内容' }}
    </view>
    <view v-if="description" class="empty-desc">
      {{ description }}
    </view>
    <view v-if="actionText" class="empty-btn" @tap="emit('action')">
      {{ actionText }}
    </view>
  </view>
</template>

<style scoped lang="scss">
.empty-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80rpx 40rpx;
  text-align: center;
}

.empty-icon-box {
  width: 120rpx;
  height: 120rpx;
  border-radius: 50%;
  background: #f7eef0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 24rpx;
}

.empty-title {
  font-size: 28rpx;
  font-weight: 700;
  color: #382e32;
  margin-bottom: 8rpx;
}

.empty-desc {
  font-size: 22rpx;
  color: #a89fa0;
  max-width: 440rpx;
  line-height: 1.5;
  margin-bottom: 28rpx;
}

.empty-btn {
  background: #cd7188;
  color: #ffffff;
  padding: 14rpx 36rpx;
  border-radius: 40rpx;
  font-size: 24rpx;
  font-weight: 600;
  box-shadow: 0 4rpx 14rpx rgba(205, 113, 136, 0.25);

  &:active {
    opacity: 0.9;
  }
}
</style>
