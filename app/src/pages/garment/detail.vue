<script lang="ts" setup>
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { Garment } from '@/types/garment'
import { getGarmentById } from '@/api/garment'
import { useFavoritesStore } from '@/store/favorites'
import { useTryonStore } from '@/store/tryon'
import { copyToClipboard, showToast } from '@/utils/platform'
import type { PreviewImageItem } from '@/utils/imagePreview'
import ImagePreviewModal from '@/components/ImagePreviewModal.vue'

defineOptions({
  name: 'GarmentDetailPage',
})

definePage({
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '服装详情',
  },
})

const garment = ref<Garment | null>(null)
const loading = ref(true)
const previewVisible = ref(false)

const favoritesStore = useFavoritesStore()
const tryonStore = useTryonStore()

const isFav = computed(() => {
  return garment.value ? favoritesStore.isFavorite(garment.value.id) : false
})

const previewItems = computed<PreviewImageItem[]>(() => {
  if (!garment.value) {
    return []
  }
  const url = garment.value.original_url || garment.value.image_url || garment.value.thumbnail_url
  return url
    ? [{ url, label: garment.value.title || garment.value.original_id }]
    : []
})

function handleBack() {
  uni.navigateBack({
    fail: () => {
      uni.switchTab({ url: '/pages/index/index' })
    },
  })
}

function handleToggleFav() {
  if (!garment.value)
    return
  const added = favoritesStore.toggleFavorite(garment.value.id)
  showToast(added ? '已添加到我的心动收藏 ✦' : '已取消收藏')
}

function handleFindSimilar() {
  if (!garment.value)
    return
  const kw = garment.value.keywords?.join(' ') || garment.value.title
  copyToClipboard(kw, '已复制搜索关键词，可在淘宝/京东以图搜同款')
}

function handleWearThis() {
  if (!garment.value)
    return
  tryonStore.setGarment(garment.value)
  showToast('已带入试衣间 ✦')
  setTimeout(() => {
    uni.switchTab({
      url: '/pages/tryon/index',
    })
  }, 300)
}

function handlePreviewImage() {
  if (!previewItems.value.length)
    return
  previewVisible.value = true
}

onLoad(async (options: any) => {
  const id = options?.id ? decodeURIComponent(options.id) : 'real:SPR-0001'
  loading.value = true
  try {
    const res = await getGarmentById(id)
    garment.value = res
  }
  finally {
    loading.value = false
  }
})
</script>

<template>
  <view class="detail-page">
    <view class="status-bar-placeholder pt-safe" />

    <!-- 顶部导航栏 -->
    <view class="nav-bar">
      <view class="nav-btn" @tap="handleBack">
        <view class="i-carbon-chevron-left text-18px" />
      </view>
      <text class="nav-title">服装详情</text>
      <view class="nav-btn" @tap="handleToggleFav">
        <view
          :class="isFav ? 'i-carbon-favorite-filled text-#cc667b' : 'i-carbon-favorite text-#333'"
          class="text-17px"
        />
      </view>
    </view>

    <view v-if="garment" class="detail-content">
      <!-- 大图展示卡片 -->
      <view class="image-box" @tap="handlePreviewImage">
        <image
          :src="garment.image_url || garment.thumbnail_url"
          mode="aspectFit"
          class="detail-img"
        />
        <view class="zoom-hint">
          <view class="i-carbon-search mr-1 text-11px text-white" />
          <text>点击查看高清原图</text>
        </view>
      </view>

      <!-- 核心信息卡片 -->
      <view class="info-card">
        <view class="tag-row">
          <text class="lib-pill">{{ garment.library === 'anime' ? '二次元动漫' : '写实穿搭' }}</text>
          <text class="cat-pill">{{ garment.category_zh || garment.category }}</text>
          <text class="id-pill">{{ garment.original_id }}</text>
        </view>

        <view class="detail-title">
          {{ garment.title || `服装编号 ${garment.original_id}` }}
        </view>

        <view class="keywords-wrap">
          <text class="kw-title">风格标签：</text>
          <view class="kw-list">
            <text
              v-for="(kw, idx) in garment.keywords"
              :key="idx"
              class="kw-badge"
            >
              #{{ kw }}
            </text>
          </view>
        </view>

        <view class="detail-note">
          <view class="i-carbon-security mt-0.5 flex-shrink-0 text-13px text-#cc8c9b" />
          <text>真实素材源自高精图集。点击「穿上这件」可与你的个人照片或内置 AI 模特融合试衣。</text>
        </view>
      </view>

      <view class="h-32" />
    </view>

    <!-- 底部固定双按钮 -->
    <view v-if="garment" class="bottom-action-bar pb-safe">
      <view class="action-btn secondary" @tap="handleFindSimilar">
        <view class="i-carbon-search text-15px" />
        <text>找同款</text>
      </view>
      <view class="action-btn primary" @tap="handleWearThis">
        <view class="i-carbon-magic-wand text-15px" />
        <text>穿上这件</text>
      </view>
    </view>

    <ImagePreviewModal
      v-model:visible="previewVisible"
      :items="previewItems"
    />
  </view>
</template>

<style scoped lang="scss">
.detail-page {
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
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);

  &:active {
    transform: scale(0.95);
  }
}

.nav-title {
  font-size: 28rpx;
  font-weight: 700;
  color: #272225;
}

.detail-content {
  padding: 16rpx 32rpx;
}

.image-box {
  width: 100%;
  height: 680rpx;
  border-radius: 32rpx;
  overflow: hidden;
  background: #f7efec;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #eee1e3;
}

.detail-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.zoom-hint {
  position: absolute;
  bottom: 20rpx;
  right: 20rpx;
  background: rgba(39, 34, 37, 0.65);
  color: #ffffff;
  padding: 8rpx 18rpx;
  border-radius: 30rpx;
  font-size: 18rpx;
  display: flex;
  align-items: center;
  backdrop-filter: blur(4px);
}

.info-card {
  margin-top: 24rpx;
  background: #ffffff;
  border-radius: 28rpx;
  padding: 30rpx;
  border: 1px solid #f2e9ea;
}

.tag-row {
  display: flex;
  gap: 12rpx;
  margin-bottom: 16rpx;
}

.lib-pill {
  background: #fce9ed;
  color: #cd7188;
  font-size: 18rpx;
  font-weight: 700;
  padding: 6rpx 16rpx;
  border-radius: 20rpx;
}

.cat-pill {
  background: #f4f1f0;
  color: #64595c;
  font-size: 18rpx;
  padding: 6rpx 16rpx;
  border-radius: 20rpx;
}

.id-pill {
  background: #faf4f5;
  color: #a4828a;
  font-size: 18rpx;
  padding: 6rpx 16rpx;
  border-radius: 20rpx;
}

.detail-title {
  font-size: 32rpx;
  font-weight: 800;
  color: #272225;
  line-height: 1.35;
  margin-bottom: 20rpx;
}

.keywords-wrap {
  margin-top: 20rpx;
}

.kw-title {
  font-size: 20rpx;
  color: #8c7e81;
  font-weight: 600;
  display: block;
  margin-bottom: 12rpx;
}

.kw-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.kw-badge {
  font-size: 20rpx;
  color: #64595c;
  background: #f6f3f2;
  padding: 8rpx 16rpx;
  border-radius: 20rpx;
}

.detail-note {
  display: flex;
  gap: 10rpx;
  align-items: flex-start;
  margin-top: 30rpx;
  padding: 18rpx;
  border-radius: 18rpx;
  background: #fcf6f7;
  color: #a49497;
  font-size: 18rpx;
  line-height: 1.5;
}

.bottom-action-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: #ffffff;
  border-top: 1px solid #f2eeee;
  padding: 16rpx 32rpx 20rpx;
  display: flex;
  gap: 20rpx;
  z-index: 100;
}

.action-btn {
  flex: 1;
  height: 84rpx;
  border-radius: 24rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  font-size: 24rpx;
  font-weight: 700;

  &.secondary {
    background: #f6f3f2;
    color: #493f42;
  }

  &.primary {
    background: #cd7188;
    color: #ffffff;
    box-shadow: 0 8rpx 24rpx rgba(205, 113, 136, 0.3);
  }

  &:active {
    transform: scale(0.98);
  }
}
</style>
