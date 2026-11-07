<script lang="ts" setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useTryonStore } from '@/store/tryon'
import { useSettingsStore } from '@/store/settings'
import { choosePersonImage, showToast } from '@/utils/platform'
import { createTryonJob } from '@/api/tryon'
import { getModelOptions } from '@/api/models'
import { uploadImageFile } from '@/api/upload'
import { MODEL_OPTIONS } from '@/mock/data'
import ImagePickerCard from '@/components/ImagePickerCard.vue'
import ModelSelector from '@/components/ModelSelector.vue'

defineOptions({
  name: 'TryonPage',
})

definePage({
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: 'AI 试衣间',
  },
})

const tryonStore = useTryonStore()
const settingsStore = useSettingsStore()

const modelOptions = ref(MODEL_OPTIONS)
const isGenerating = ref(false)
const lastGeneratedJob = ref<any>(null)

const personDisplayUrl = computed(() => {
  return tryonStore.draft.personLocalPath || tryonStore.draft.selectedPortraitUrl || null
})

const garmentDisplayUrl = computed(() => {
  return tryonStore.draft.garmentImageUrl || null
})

const isAnimeGarment = computed(() => {
  return tryonStore.draft.garmentId?.startsWith('anime:') || false
})

function handleGoKnowledge(category?: string) {
  const url = category ? `/pages/knowledge/index?category=${encodeURIComponent(category)}` : '/pages/knowledge/index'
  uni.navigateTo({ url })
}

function handleGoKnowledgeDetail(id: string) {
  uni.navigateTo({
    url: `/pages/knowledge/detail?id=${encodeURIComponent(id)}`,
  })
}

const canGenerate = computed(() => {
  const hasPerson = Boolean(tryonStore.draft.personLocalPath || tryonStore.draft.selectedPortraitId)
  const hasGarment = Boolean(tryonStore.draft.garmentId)
  return hasPerson && hasGarment && !isGenerating.value
})

async function handleChooseLocalPhoto() {
  const path = await choosePersonImage()
  if (path) {
    tryonStore.setPersonPhoto(path)
    showToast('已载入本地照片 ✦')
  }
}

function handleGoSelectModel() {
  uni.navigateTo({
    url: '/pages/models/index',
  })
}

function handleGoSelectGarment() {
  uni.switchTab({
    url: '/pages/gallery/index',
  })
}

function handleSelectEngine(key: string) {
  tryonStore.setModel(key)
  showToast(`已选择 ${key} 模型`)
}

function handleGoSettings() {
  uni.navigateTo({
    url: '/pages/mine/settings',
  })
}

async function handleStartTryon() {
  if (!tryonStore.draft.personLocalPath && !tryonStore.draft.selectedPortraitId) {
    showToast('请先上传人像照片或选择一位 AI 模特')
    return
  }
  if (!tryonStore.draft.garmentId) {
    showToast('请先选择一件心动服装')
    return
  }

  isGenerating.value = true
  uni.showLoading({
    title: 'AI 换装计算中...',
    mask: true,
  })

  try {
    let personFileId: string | undefined

    // 若使用的是本地拍摄照片且未开启 mock，先上传得到 file_id
    if (tryonStore.draft.personLocalPath) {
      if (!settingsStore.useMock) {
        uni.showLoading({ title: '安全上传人像中...' })
        const upRes = await uploadImageFile(tryonStore.draft.personLocalPath)
        personFileId = upRes.file_id
      }
      else {
        personFileId = 'mock-person-file'
      }
    }

    const clientRequestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

    const job = await createTryonJob({
      garment_id: tryonStore.draft.garmentId,
      person_file_id: personFileId,
      portrait_id: tryonStore.draft.selectedPortraitId || undefined,
      model_key: tryonStore.draft.modelKey,
      size: tryonStore.draft.size,
      keep_face: tryonStore.draft.keepFace,
      client_request_id: clientRequestId,
    })

    // 补齐元数据
    job.garment_image_url = garmentDisplayUrl.value || undefined
    job.person_image_url = personDisplayUrl.value || undefined

    tryonStore.addHistory(job)
    tryonStore.currentJob = job
    lastGeneratedJob.value = job

    uni.hideLoading()
    showToast('换装完成！✦', 'success')

    // 页面跳转到换装结果详情
    setTimeout(() => {
      uni.navigateTo({
        url: `/pages/tryon/result?id=${encodeURIComponent(job.id)}`,
      })
    }, 600)
  }
  catch (err: any) {
    uni.hideLoading()
    console.error('Tryon generation error', err)
    showToast(err.message || '换装服务繁忙，请稍后重试')
  }
  finally {
    isGenerating.value = false
  }
}

function handleViewLatest() {
  if (lastGeneratedJob.value) {
    uni.navigateTo({
      url: `/pages/tryon/result?id=${encodeURIComponent(lastGeneratedJob.value.id)}`,
    })
  }
}

onShow(async () => {
  const options = await getModelOptions()
  if (options && options.length) {
    modelOptions.value = options
  }
})
</script>

<template>
  <view class="tryon-page">
    <view class="status-bar-placeholder pt-safe" />

    <view class="screen-scroller">
      <!-- 页面标头 -->
      <view class="std-head">
        <view class="head-titles">
          <text class="eyebrow">拍片哥女装 · PAIPIANGE</text>
          <view class="main-title">
            AI 试衣间
          </view>
          <text class="sub-title">你来挑衣服，剩下交给想象力。</text>
        </view>
        <view class="head-action-group">
          <view class="round-icon-btn mr-2" @tap="handleGoKnowledge('tryon-tips')">
            <view class="i-carbon-book text-16px text-#382e32" />
          </view>
          <view class="round-icon-btn" @tap="handleGoSettings">
            <view class="i-carbon-settings text-17px text-#382e32" />
          </view>
        </view>
      </view>

      <!-- 步骤指示 -->
      <view class="step-progress">
        <text class="step-on">01 上传人像</text>
        <view class="step-line" />
        <text class="step-on">02 选择服装</text>
        <view class="step-line" />
        <text :class="{ 'step-on': canGenerate }">03 AI 生成</text>
      </view>

      <!-- 双向选择卡片行 -->
      <view class="try-rows">
        <ImagePickerCard
          title="你的照片"
          :image-url="personDisplayUrl"
          placeholder-text="点击上传本人站立照片或自拍"
          action-text="拍照/相册"
          secondary-action-text="选AI模特"
          @action="handleChooseLocalPhoto"
          @secondary-action="handleGoSelectModel"
        />

        <view class="try-arrow">
          <view class="i-carbon-arrow-right text-14px" />
        </view>

        <ImagePickerCard
          title="挑选服装"
          :image-url="garmentDisplayUrl"
          placeholder-text="从灵感图库挑选一件心动穿搭"
          action-text="挑衣服"
          @action="handleGoSelectGarment"
        />
      </view>

      <!-- 二次元华服专属引导横幅 -->
      <view v-if="isAnimeGarment" class="anime-guide-banner">
        <view class="anime-guide-left">
          <view class="anime-badge-row">
            <text class="anime-badge">✦ 二次元动漫穿搭</text>
            <text class="anime-sub-tag">插画级渲染</text>
          </view>
          <text class="anime-guide-text">已选中动漫服饰！推荐搭配火山豆包或ComfyUI模型，出图更具动漫插画质感。</text>
        </view>
        <view class="anime-guide-link" @tap="handleGoKnowledgeDetail('kb-anime-style-guide')">
          <text>穿搭指南</text>
          <view class="i-carbon-chevron-right text-12px" />
        </view>
      </view>

      <!-- 提示卡片 -->
      <view class="try-note">
        <view class="i-carbon-security mt-0.5 flex-shrink-0 text-13px text-#cc8c9b" />
        <view class="try-note-body">
          <text class="try-note-main">这里展示的是样图。正式上传和生成前，请确保拥有人像使用授权，并知晓换装可能通过第三方安全模型处理。</text>
          <view class="try-kb-link" @tap="handleGoKnowledgeDetail('kb-tryon-secrets')">
            <text>📖 查看《AI 虚拟换装高成功率秘籍》➔</text>
          </view>
        </view>
      </view>

      <!-- 模型选择栏 -->
      <view class="section-title try-settings-title">
        <view>
          <text class="section-small">YOUR AI ENGINE</text>
          <view class="section-h3">
            选择生成模型
          </view>
        </view>
        <text class="tiny-badge">可配置</text>
      </view>

      <ModelSelector
        :models="modelOptions"
        :active-model-key="tryonStore.draft.modelKey"
        @select="handleSelectEngine"
      />

      <!-- 尺寸比例设置 -->
      <view class="ratio-row">
        <view class="ratio-left">
          <view class="ratio-icon">
            <view class="i-carbon-image text-16px" />
          </view>
          <view class="ratio-info">
            <text class="ratio-title">竖版全身照</text>
            <text class="ratio-desc">推荐 2:3 比例 · 高画质全身渲染</text>
          </view>
        </view>
        <text class="ratio-badge">2:3 (1024×1536)</text>
      </view>

      <!-- 保持面部一致性选项 -->
      <view class="keepface-row">
        <view class="keepface-left">
          <text class="keepface-title">保持人物面部特征</text>
          <text class="keepface-desc">锁定五官与发型，仅更换服装材质与穿搭</text>
        </view>
        <switch
          :checked="tryonStore.draft.keepFace"
          color="#cd7188"
          class="scale-85"
          @change="(e) => tryonStore.setKeepFace(e.detail.value)"
        />
      </view>

      <!-- 生成历史结果提示（若有） -->
      <view
        v-if="lastGeneratedJob"
        class="try-output"
        @tap="handleViewLatest"
      >
        <view class="output-left">
          <view class="i-carbon-checkmark-outline text-16px text-#b95e74" />
          <text class="output-title">最新作品已就绪</text>
          <text class="output-desc">点击立即查看完整高清换装结果 →</text>
        </view>
        <image
          :src="lastGeneratedJob.result_url || lastGeneratedJob.garment_image_url"
          mode="aspectFill"
          class="output-thumb"
        />
      </view>

      <!-- 生成主按钮 -->
      <view
        class="generate-btn"
        :class="{ disabled: !canGenerate }"
        @tap="handleStartTryon"
      >
        <view class="i-carbon-magic-wand text-16px" />
        <text>{{ isGenerating ? 'AI 换装计算中...' : '开始 AI 换装' }}</text>
        <text class="btn-arrow">→</text>
      </view>

      <view class="cost-hint">
        图库浏览免费 · AI 换装需接入后端和模型额度
      </view>

      <view class="h-24" />
    </view>

    <!-- 底部 Tabbar -->
    <fg-tabbar />
  </view>
</template>

<style scoped lang="scss">
.tryon-page {
  min-height: 100vh;
  background-color: #fcfbfa;
  color: #272225;
}

.screen-scroller {
  padding: 0 32rpx 40rpx;
}

.std-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin: 32rpx 0 28rpx;
}

.eyebrow {
  color: #c39fa7;
  font-size: 16rpx;
  font-weight: 800;
  letter-spacing: 3.6rpx;
}

.main-title {
  font-size: 46rpx;
  letter-spacing: -1rpx;
  margin: 12rpx 0 8rpx;
  line-height: 1.15;
  font-weight: 800;
  color: #272225;
}

.sub-title {
  font-size: 20rpx;
  color: #a89b99;
}

.head-action-group {
  display: flex;
  align-items: center;
}

.round-icon-btn {
  border: 1px solid #eae5e4;
  width: 66rpx;
  height: 66rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ffffff;
}

.step-progress {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 18rpx;
  color: #a89da0;
  white-space: nowrap;
  margin-bottom: 24rpx;

  text {
    padding: 12rpx 16rpx;
    border-radius: 60rpx;
    background: #f6f3f2;
  }

  .step-on {
    background: #f6e5ea;
    color: #b86a7c;
    font-weight: 700;
  }
}

.step-line {
  height: 1px;
  flex: 1;
  background: #e6dcdf;
  margin: 0 8rpx;
}

.try-rows {
  display: flex;
  align-items: center;
  gap: 14rpx;
}

.try-arrow {
  border-radius: 50%;
  width: 48rpx;
  height: 48rpx;
  background: #f7e8eb;
  color: #c77588;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}

.anime-guide-banner {
  background: linear-gradient(135deg, #f6edf9 0%, #fdf2f7 100%);
  border: 1px solid rgba(168, 85, 247, 0.2);
  border-radius: 20rpx;
  padding: 20rpx 24rpx;
  margin-top: 20rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}

.anime-guide-left {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.anime-badge-row {
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.anime-badge {
  font-size: 20rpx;
  font-weight: 700;
  color: #9333ea;
}

.anime-sub-tag {
  font-size: 18rpx;
  color: #c026d3;
  background: rgba(192, 38, 211, 0.1);
  padding: 2rpx 8rpx;
  border-radius: 4rpx;
}

.anime-guide-text {
  font-size: 20rpx;
  color: #6b21a8;
  line-height: 1.45;
}

.anime-guide-link {
  display: flex;
  align-items: center;
  gap: 4rpx;
  color: #9333ea;
  font-size: 22rpx;
  font-weight: 700;
  white-space: nowrap;
}

.try-note {
  display: flex;
  align-items: flex-start;
  gap: 12rpx;
  color: #a4999d;
  font-size: 18rpx;
  line-height: 1.5;
  background: #f8f5f4;
  border-radius: 20rpx;
  padding: 18rpx 22rpx;
  margin: 22rpx 0 32rpx;
}

.try-note-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.try-note-main {
  font-size: 18rpx;
  color: #8b7f83;
}

.try-kb-link {
  font-size: 20rpx;
  font-weight: 600;
  color: #cd657b;
}

.section-title {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 20rpx;
}

.section-small {
  font-size: 16rpx;
  font-weight: 750;
  color: #bc9d9f;
  letter-spacing: 3rpx;
}

.section-h3 {
  font-size: 34rpx;
  line-height: 1.35;
  margin-top: 4rpx;
  font-weight: 800;
  color: #272225;
}

.tiny-badge {
  font-size: 18rpx;
  background: #f7ecee;
  padding: 8rpx 16rpx;
  border-radius: 40rpx;
  color: #c17f8c;
  font-weight: 600;
}

.ratio-row {
  margin: 32rpx 0 24rpx;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #ffffff;
  padding: 20rpx 24rpx;
  border-radius: 24rpx;
  border: 1px solid #f4f0ef;
}

.ratio-left {
  display: flex;
  gap: 18rpx;
  align-items: center;
}

.ratio-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #bf8a93;
  background: #f9eff1;
  border-radius: 18rpx;
  width: 64rpx;
  height: 64rpx;
}

.ratio-title {
  font-size: 22rpx;
  font-weight: 700;
  color: #382e32;
  display: block;
}

.ratio-desc {
  font-size: 18rpx;
  color: #a79e9d;
  margin-top: 4rpx;
  display: block;
}

.ratio-badge {
  font-size: 20rpx;
  color: #af9da0;
  font-weight: 600;
}

.keepface-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #ffffff;
  padding: 20rpx 24rpx;
  border-radius: 24rpx;
  border: 1px solid #f4f0ef;
  margin-bottom: 32rpx;
}

.keepface-title {
  font-size: 22rpx;
  font-weight: 700;
  color: #382e32;
  display: block;
}

.keepface-desc {
  font-size: 18rpx;
  color: #a79e9d;
  margin-top: 4rpx;
  display: block;
}

.generate-btn {
  width: 100%;
  border-radius: 24rpx;
  background: #cd7188;
  color: white;
  font-size: 26rpx;
  font-weight: 800;
  padding: 28rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
  box-shadow: 0 10rpx 30rpx rgba(204, 113, 136, 0.25);
  box-sizing: border-box;
  transition: all 0.2s ease;

  &:active {
    transform: scale(0.98);
  }

  &.disabled {
    opacity: 0.55;
  }
}

.btn-arrow {
  margin-left: auto;
  font-size: 32rpx;
  font-weight: 400;
}

.cost-hint {
  text-align: center;
  color: #ad9fa3;
  font-size: 18rpx;
  margin: 24rpx 0;
}

.try-output {
  display: flex;
  gap: 16rpx;
  align-items: center;
  border-radius: 24rpx;
  background: #f7e8ec;
  margin-bottom: 26rpx;
  padding: 20rpx;
}

.output-left {
  flex: 1;
}

.output-title {
  font-size: 22rpx;
  font-weight: 700;
  color: #382e32;
  display: block;
}

.output-desc {
  color: #a08c90;
  font-size: 18rpx;
  margin-top: 4rpx;
  display: block;
}

.output-thumb {
  width: 80rpx;
  height: 110rpx;
  border-radius: 14rpx;
  object-fit: cover;
}
</style>
