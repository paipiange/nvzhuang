<script lang="ts" setup>
import { computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useTryonStore } from '@/store/tryon'
import { deleteTryonHistoryApi } from '@/api/tryon'
import { showToast } from '@/utils/platform'
import EmptyState from '@/components/EmptyState.vue'

defineOptions({
  name: 'HistoryPage',
})

definePage({
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '试穿记录',
  },
})

const tryonStore = useTryonStore()
const historyList = computed(() => tryonStore.history)

function handleBack() {
  uni.navigateBack({
    fail: () => {
      uni.switchTab({ url: '/pages/mine/index' })
    },
  })
}

function handleGoTryon() {
  uni.switchTab({
    url: '/pages/tryon/index',
  })
}

function handleItemClick(id: string) {
  uni.navigateTo({
    url: `/pages/tryon/result?id=${encodeURIComponent(id)}`,
  })
}

async function handleDeleteItem(id: string, e: Event) {
  e.stopPropagation()
  uni.showModal({
    title: '确认删除',
    content: '确定要删除这条试穿记录吗？对应的换装结果将被清除。',
    confirmColor: '#cd7188',
    success: async (res) => {
      if (res.confirm) {
        tryonStore.deleteHistory(id)
        await deleteTryonHistoryApi(id)
        showToast('已删除记录')
      }
    },
  })
}

function handleClearAll() {
  if (historyList.value.length === 0)
    return
  uni.showModal({
    title: '清空历史',
    content: '确定要清空所有试穿记录吗？该操作无法撤销。',
    confirmColor: '#cd7188',
    success: (res) => {
      if (res.confirm) {
        tryonStore.clearHistory()
        showToast('试穿记录已清空')
      }
    },
  })
}

onShow(() => {
  tryonStore.initHistory()
})
</script>

<template>
  <view class="history-page">
    <view class="status-bar-placeholder pt-safe" />

    <view class="nav-bar">
      <view class="nav-btn" @tap="handleBack">
        <view class="i-carbon-chevron-left text-18px" />
      </view>
      <text class="nav-title">试穿记录 ({{ historyList.length }})</text>
      <view
        v-if="historyList.length > 0"
        class="clear-text-btn"
        @tap="handleClearAll"
      >
        清空
      </view>
      <view v-else class="w-68rpx" />
    </view>

    <view class="page-body">
      <view v-if="historyList.length > 0" class="history-list">
        <view
          v-for="item in historyList"
          :key="item.id"
          class="history-card"
          @tap="handleItemClick(item.id)"
        >
          <image
            :src="item.result_url || item.garment_image_url || 'https://paipiange.github.io/nvzhuang/assets/thumbs/SPR-0001.webp'"
            mode="aspectFill"
            class="history-thumb"
          />
          <view class="history-content">
            <view class="history-top">
              <text class="history-model-tag">{{ item.model }}</text>
              <view
                class="del-btn"
                @tap="(e) => handleDeleteItem(item.id, e)"
              >
                <view class="i-carbon-trash-can text-14px text-#b8a4a8" />
              </view>
            </view>
            <view class="history-garment-title">
              服装：{{ item.garment_id }}
            </view>
            <view class="history-time">
              {{ new Date(item.created_at).toLocaleString() }}
            </view>
          </view>
        </view>
      </view>

      <EmptyState
        v-else
        title="暂无试穿记录"
        description="挑选心动服装并在 AI 试衣间中点击生成，作品将保存在这里"
        action-text="前往试衣间"
        @action="handleGoTryon"
      />
    </view>
  </view>
</template>

<style scoped lang="scss">
.history-page {
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

.clear-text-btn {
  font-size: 22rpx;
  color: #b86076;
  font-weight: 600;
  padding: 8rpx 16rpx;
}

.page-body {
  padding: 20rpx 32rpx 40rpx;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.history-card {
  display: flex;
  background: #ffffff;
  border-radius: 24rpx;
  overflow: hidden;
  border: 1px solid #f2e9ea;
  padding: 18rpx;
  gap: 20rpx;

  &:active {
    background: #fdfafb;
  }
}

.history-thumb {
  width: 140rpx;
  height: 190rpx;
  border-radius: 16rpx;
  object-fit: cover;
  flex: 0 0 auto;
}

.history-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.history-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.history-model-tag {
  background: #fce9ed;
  color: #cd7188;
  font-size: 18rpx;
  font-weight: 700;
  padding: 4rpx 14rpx;
  border-radius: 20rpx;
}

.del-btn {
  padding: 8rpx;
}

.history-garment-title {
  font-size: 24rpx;
  font-weight: 700;
  color: #272225;
  margin: 10rpx 0;
}

.history-time {
  font-size: 18rpx;
  color: #a89fa0;
}
</style>
