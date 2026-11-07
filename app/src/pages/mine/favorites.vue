<script lang="ts" setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import type { Garment } from '@/types/garment'
import { useFavoritesStore } from '@/store/favorites'
import { getGarmentById } from '@/api/garment'
import GarmentCard from '@/components/GarmentCard.vue'
import EmptyState from '@/components/EmptyState.vue'

defineOptions({
  name: 'FavoritesPage',
})

definePage({
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '我的心动款',
  },
})

const favoritesStore = useFavoritesStore()
const favoriteGarments = ref<Garment[]>([])
const loading = ref(false)

async function loadFavorites() {
  loading.value = true
  const list: Garment[] = []
  for (const id of favoritesStore.favoriteIds) {
    const item = await getGarmentById(id)
    if (item)
      list.push(item)
  }
  favoriteGarments.value = list
  loading.value = false
}

function handleBack() {
  uni.navigateBack({
    fail: () => {
      uni.switchTab({ url: '/pages/mine/index' })
    },
  })
}

function handleGoGallery() {
  uni.switchTab({
    url: '/pages/gallery/index',
  })
}

onShow(() => {
  loadFavorites()
})
</script>

<template>
  <view class="fav-page">
    <view class="status-bar-placeholder pt-safe" />

    <view class="nav-bar">
      <view class="nav-btn" @tap="handleBack">
        <view class="i-carbon-chevron-left text-18px" />
      </view>
      <text class="nav-title">我的心动款 ({{ favoriteGarments.length }})</text>
      <view class="w-68rpx" />
    </view>

    <view class="page-body">
      <view v-if="favoriteGarments.length > 0" class="looks-grid">
        <GarmentCard
          v-for="item in favoriteGarments"
          :key="item.id"
          :garment="item"
          :tall="true"
        />
      </view>

      <EmptyState
        v-else-if="!loading"
        title="还没有收藏服装"
        description="在发现或图库中点击爱心图标，即可保存喜欢的穿搭灵感"
        action-text="去图库逛逛"
        @action="handleGoGallery"
      />
    </view>
  </view>
</template>

<style scoped lang="scss">
.fav-page {
  min-height: 100vh;
  background-color: #fcfbfa;
  color: #272225;
}

.nav-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16rpx 32rpx;
  height: 88rpx;
}

.nav-btn {
  width: 68rpx;
  height: 68rpx;
  border-radius: 50%;
  background: #ffffff;
  border: 1px solid #eae5e4;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nav-title {
  font-size: 28rpx;
  font-weight: 700;
}

.page-body {
  padding: 20rpx 32rpx 40rpx;
}

.looks-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 30rpx 20rpx;
}
</style>
