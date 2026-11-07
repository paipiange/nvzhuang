<script setup lang="ts">
import type { CategoryItem, GarmentCategory } from '@/types/garment'

defineProps<{
  categories: CategoryItem[]
  activeCategory: GarmentCategory | 'all'
}>()

const emit = defineEmits<{
  (e: 'select', category: GarmentCategory | 'all'): void
}>()

function handleClick(key: GarmentCategory | 'all') {
  emit('select', key)
}
</script>

<template>
  <scroll-view scroll-x class="chips-scroll" :show-scrollbar="false">
    <view class="chips-row">
      <view
        v-for="cat in categories"
        :key="cat.key"
        class="chip"
        :class="{ active: activeCategory === cat.key }"
        @tap="handleClick(cat.key)"
      >
        {{ cat.name }}
      </view>
    </view>
  </scroll-view>
</template>

<style scoped lang="scss">
.chips-scroll {
  white-space: nowrap;
  width: 100%;
  margin-bottom: 24rpx;
}

.chips-row {
  display: inline-flex;
  gap: 14rpx;
  padding: 0 4rpx;
}

.chip {
  flex: 0 0 auto;
  border-radius: 60rpx;
  padding: 14rpx 28rpx;
  font-size: 22rpx;
  background: #f4f2f0;
  color: #81787a;
  font-weight: 600;
  transition: all 0.2s ease;

  &.active {
    color: #ffffff;
    background: #cb7788;
    box-shadow: 0 4rpx 12rpx rgba(203, 119, 136, 0.25);
  }

  &:active {
    opacity: 0.85;
  }
}
</style>
