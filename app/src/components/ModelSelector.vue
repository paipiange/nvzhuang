<script setup lang="ts">
import type { ModelOption } from '@/types/tryon'

defineProps<{
  models: ModelOption[]
  activeModelKey: string
}>()

const emit = defineEmits<{
  (e: 'select', key: string): void
}>()
</script>

<template>
  <view class="model-options">
    <view
      v-for="m in models"
      :key="m.key"
      class="engine-card"
      :class="{ active: activeModelKey === m.key }"
      @tap="emit('select', m.key)"
    >
      <text class="engine-icon">{{ m.icon }}</text>
      <text class="engine-name">{{ m.name }}</text>
      <text v-if="m.badge" class="engine-badge">{{ m.badge }}</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.model-options {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12rpx;
}

.engine-card {
  position: relative;
  font-size: 20rpx;
  border: 1px solid #e9e2e3;
  border-radius: 18rpx;
  padding: 18rpx 6rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6rpx;
  color: #85797e;
  background: #ffffff;
  transition: all 0.2s ease;

  &.active {
    border-color: #cf8d9a;
    background: #f9edef;
    color: #bd6f84;
    font-weight: 800;
  }

  &:active {
    transform: scale(0.97);
  }
}

.engine-icon {
  font-size: 24rpx;
  color: #cd7188;
}

.engine-name {
  white-space: nowrap;
  font-size: 20rpx;
}

.engine-badge {
  position: absolute;
  top: -8rpx;
  right: -8rpx;
  font-size: 16rpx;
  background: #cd7188;
  color: #ffffff;
  border-radius: 20rpx;
  padding: 2rpx 8rpx;
  transform: scale(0.85);
}
</style>
