<script lang="ts" setup>
import { onMounted, ref } from 'vue'
import type { ModelPortrait } from '@/types/garment'
import { getModelPortraits } from '@/api/models'
import { useTryonStore } from '@/store/tryon'
import { showToast } from '@/utils/platform'

defineOptions({
  name: 'ModelsPage',
})

definePage({
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '选择 AI 模特',
  },
})

const tryonStore = useTryonStore()

const hairstyleTabs = ['全部', '短发', '中发', '长发']
const activeTab = ref('全部')
const portraits = ref<ModelPortrait[]>([])
const loading = ref(false)

async function loadPortraits() {
  loading.value = true
  try {
    const res = await getModelPortraits({
      hairstyle: activeTab.value,
      page: 1,
      page_size: 30,
    })
    portraits.value = res.list
  }
  finally {
    loading.value = false
  }
}

function handleTabClick(tab: string) {
  if (activeTab.value === tab)
    return
  activeTab.value = tab
  loadPortraits()
}

function handleSelectPortrait(item: ModelPortrait) {
  tryonStore.setPortrait(item)
  showToast(`已选择模特：${item.name} ✦`)
  setTimeout(() => {
    uni.navigateBack({
      fail: () => {
        uni.switchTab({ url: '/pages/tryon/index' })
      },
    })
  }, 350)
}

function handleBack() {
  uni.navigateBack({
    fail: () => {
      uni.switchTab({ url: '/pages/tryon/index' })
    },
  })
}

onMounted(() => {
  loadPortraits()
})
</script>

<template>
  <view class="models-page">
    <view class="status-bar-placeholder pt-safe" />

    <view class="nav-bar">
      <view class="nav-btn" @tap="handleBack">
        <view class="i-carbon-chevron-left text-18px" />
      </view>
      <text class="nav-title">选择 AI 模特</text>
      <view class="w-68rpx" />
    </view>

    <view class="page-body">
      <!-- 发型切换胶囊 -->
      <view class="tabs-row">
        <view
          v-for="tab in hairstyleTabs"
          :key="tab"
          class="tab-chip"
          :class="{ active: activeTab === tab }"
          @tap="handleTabClick(tab)"
        >
          {{ tab }}
        </view>
      </view>

      <view class="hint-text">
        选择一位官方授权模特作为试衣人像，无需上传个人照片
      </view>

      <!-- 模特卡片网格 -->
      <view class="models-grid">
        <view
          v-for="p in portraits"
          :key="p.id"
          class="portrait-card"
          @tap="handleSelectPortrait(p)"
        >
          <image
            :src="p.thumbnail_url || p.image_url"
            mode="aspectFill"
            class="portrait-img"
            lazy-load
          />
          <view class="portrait-info">
            <text class="portrait-name">{{ p.name }}</text>
            <text class="portrait-tag">{{ p.hairstyle || p.category }}</text>
          </view>
        </view>
      </view>

      <view v-if="loading" class="py-10 text-center text-11px text-#bba">
        正在载入 AI 模特库...
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.models-page {
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

.tabs-row {
  display: flex;
  gap: 14rpx;
  margin-bottom: 20rpx;
}

.tab-chip {
  padding: 12rpx 26rpx;
  border-radius: 40rpx;
  font-size: 20rpx;
  background: #f4f1f0;
  color: #7a7072;
  font-weight: 600;

  &.active {
    background: #cb7788;
    color: #ffffff;
  }
}

.hint-text {
  font-size: 20rpx;
  color: #9c8e90;
  margin-bottom: 24rpx;
}

.models-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20rpx;
}

.portrait-card {
  background: #ffffff;
  border-radius: 24rpx;
  overflow: hidden;
  border: 1px solid #f0e6e7;
  cursor: pointer;

  &:active {
    transform: scale(0.98);
  }
}

.portrait-img {
  width: 100%;
  height: 380rpx;
  object-fit: cover;
  display: block;
  background: #f6efe9;
}

.portrait-info {
  padding: 16rpx 18rpx;
}

.portrait-name {
  font-size: 22rpx;
  font-weight: 700;
  color: #272225;
  display: block;
}

.portrait-tag {
  font-size: 18rpx;
  color: #ab9b9e;
  margin-top: 4rpx;
  display: block;
}
</style>
