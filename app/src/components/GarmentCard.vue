<script setup lang="ts">
import type { Garment } from '@/types/garment'
import { useFavoritesStore } from '@/store/favorites'
import { showToast } from '@/utils/platform'

const props = defineProps<{
  garment: Garment
  tall?: boolean
}>()

const favoritesStore = useFavoritesStore()

const isFav = computed(() => favoritesStore.isFavorite(props.garment.id))

function handleToggleFav(e: Event) {
  // 阻止冒泡
  e.stopPropagation()
  const added = favoritesStore.toggleFavorite(props.garment.id)
  showToast(added ? '已收藏这套穿搭 ✦' : '已取消收藏')
}

function handleCardClick() {
  uni.navigateTo({
    url: `/pages/garment/detail?id=${encodeURIComponent(props.garment.id)}`,
  })
}
</script>

<template>
  <view class="look-card" @tap="handleCardClick">
    <view class="look-photo" :class="{ tall }">
      <image
        :src="garment.thumbnail_url || garment.image_url"
        mode="aspectFill"
        class="card-img"
        lazy-load
      />
      <!-- 收藏爱心按钮 -->
      <view
        class="fav-btn"
        :class="{ 'is-saved': isFav }"
        @tap.stop="handleToggleFav"
      >
        <view
          :class="isFav ? 'i-carbon-favorite-filled text-#cc667b' : 'i-carbon-favorite text-#777'"
          class="text-13px"
        />
      </view>
    </view>
    <view class="look-title">
      {{ garment.title || `服装 ${garment.original_id}` }}
    </view>
    <view class="look-sub">
      {{ garment.category_zh || garment.category }} · {{ garment.library === 'anime' ? '二次元' : '写实' }}
    </view>
  </view>
</template>

<style scoped lang="scss">
.look-card {
  min-width: 0;
  cursor: pointer;
}

.look-photo {
  height: 352rpx;
  border-radius: 24rpx;
  position: relative;
  overflow: hidden;
  background: #f0eae6;

  &.tall {
    height: 380rpx;
  }
}

.card-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.fav-btn {
  position: absolute;
  right: 14rpx;
  top: 14rpx;
  width: 52rpx;
  height: 52rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(4px);
  transition: all 0.2s ease;
  z-index: 2;

  &:active {
    transform: scale(0.9);
  }
}

.look-title {
  font-size: 24rpx;
  margin-top: 14rpx;
  font-weight: 700;
  color: #272225;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}

.look-sub {
  font-size: 20rpx;
  margin-top: 6rpx;
  color: #a89fa0;
}
</style>
