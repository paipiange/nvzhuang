<script lang="ts" setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { TryonJob } from '@/types/tryon'
import { useTryonStore } from '@/store/tryon'
import { getTryonJob } from '@/api/tryon'
import { copyToClipboard, saveImageToAlbum, showToast } from '@/utils/platform'
import TryonCompare from '@/components/TryonCompare.vue'

defineOptions({
  name: 'TryonResultPage',
})

definePage({
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '换装结果',
  },
})

const tryonStore = useTryonStore()
const job = ref<TryonJob | null>(null)
const loading = ref(true)

function handleBack() {
  uni.navigateBack({
    fail: () => {
      uni.switchTab({ url: '/pages/tryon/index' })
    },
  })
}

function handleSave() {
  if (!job.value?.result_url)
    return
  saveImageToAlbum(job.value.result_url)
}

function handleShare() {
  // #ifdef MP-WEIXIN
  showToast('请点击右上角「···」分享给好友')
  // #endif
  // #ifndef MP-WEIXIN
  if (job.value?.result_url) {
    copyToClipboard(job.value.result_url, '已复制作品图片链接')
  }
  // #endif
}

function handleTryAnother() {
  uni.switchTab({
    url: '/pages/gallery/index',
  })
}

onLoad(async (options: any) => {
  const jobId = options?.id ? decodeURIComponent(options.id) : null
  if (jobId) {
    // 优先从 store 缓存取
    const cached = tryonStore.history.find(j => j.id === jobId)
    if (cached) {
      job.value = cached
      loading.value = false
      return
    }

    try {
      const res = await getTryonJob(jobId)
      job.value = res
    }
    finally {
      loading.value = false
    }
  }
  else if (tryonStore.currentJob) {
    job.value = tryonStore.currentJob
    loading.value = false
  }
})
</script>

<template>
  <view class="result-page">
    <view class="status-bar-placeholder pt-safe" />

    <view class="nav-bar">
      <view class="nav-btn" @tap="handleBack">
        <view class="i-carbon-chevron-left text-18px" />
      </view>
      <text class="nav-title">换装完成</text>
      <view class="nav-btn" @tap="handleShare">
        <view class="i-carbon-share text-16px text-#382e32" />
      </view>
    </view>

    <view v-if="job && job.result_url" class="result-body">
      <!-- 对比预览卡片 -->
      <TryonCompare
        :person-url="job.person_image_url || null"
        :garment-url="job.garment_image_url || null"
        :result-url="job.result_url"
        :model-name="job.model"
      />

      <view class="result-meta">
        <text class="meta-item">生成时间：{{ new Date(job.created_at).toLocaleString() }}</text>
        <text class="meta-item">AI 引擎：{{ job.model }}</text>
      </view>

      <!-- 操作按钮组 -->
      <view class="actions-group">
        <view class="action-btn primary" @tap="handleSave">
          <view class="i-carbon-download mr-1 text-15px" />
          <text>保存到相册</text>
        </view>
        <view class="action-btn secondary" @tap="handleTryAnother">
          <view class="i-carbon-magic-wand mr-1 text-15px" />
          <text>再试一件</text>
        </view>
      </view>
    </view>

    <view v-else-if="!loading" class="empty-wrap">
      <view class="i-carbon-warning mb-3 text-32px text-#cc8c9b" />
      <text class="empty-title">未找到换装结果</text>
      <text class="empty-desc">该作品可能已被删除，或生成任务尚未就绪。</text>
      <view class="back-btn" @tap="handleBack">
        返回试衣间
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.result-page {
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

.result-body {
  padding: 20rpx 32rpx 40rpx;
}

.result-meta {
  display: flex;
  justify-content: space-between;
  margin-top: 24rpx;
  font-size: 18rpx;
  color: #9d8e91;
  padding: 0 10rpx;
}

.actions-group {
  margin-top: 40rpx;
  display: flex;
  gap: 20rpx;
}

.action-btn {
  flex: 1;
  height: 86rpx;
  border-radius: 24rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24rpx;
  font-weight: 700;

  &.primary {
    background: #cd7188;
    color: #ffffff;
    box-shadow: 0 8rpx 24rpx rgba(205, 113, 136, 0.28);
  }

  &.secondary {
    background: #f4f1f0;
    color: #382e32;
  }

  &:active {
    transform: scale(0.98);
  }
}

.empty-wrap {
  padding: 120rpx 40rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.empty-title {
  font-size: 28rpx;
  font-weight: 700;
  margin-bottom: 8rpx;
}

.empty-desc {
  font-size: 22rpx;
  color: #9d8e91;
  margin-bottom: 30rpx;
}

.back-btn {
  background: #cd7188;
  color: #ffffff;
  padding: 16rpx 40rpx;
  border-radius: 40rpx;
  font-size: 24rpx;
  font-weight: 700;
}
</style>
