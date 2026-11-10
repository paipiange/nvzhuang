<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import type { Garment, LibraryType } from '@/types/garment'
import type { KnowledgeArticle } from '@/types/knowledge'
import { getGarments } from '@/api/garment'
import { getFeaturedKnowledgeArticles } from '@/data/knowledge'
import { useSettingsStore } from '@/store/settings'
import { getCurrentBaseUrl } from '@/utils'
import GarmentCard from '@/components/GarmentCard.vue'

defineOptions({
  name: 'IndexPage',
})

definePage({
  type: 'home',
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '拍片哥女装',
  },
})

const settingsStore = useSettingsStore()

const activeFeaturedTab = ref<LibraryType>('real')
const featuredGarments = ref<Garment[]>([])
const featuredArticles = ref<KnowledgeArticle[]>([])
const loading = ref(false)
const networkIssueVisible = ref(false)

const activeServerUrl = computed(() => {
  return (settingsStore.serverBaseUrl?.trim() || getCurrentBaseUrl() || '').trim()
})

let hasMounted = false
let requestVersion = 0
let lastLoadedSignature = ''
let lastPromptedSignature = ''
let isConfigModalOpen = false

function getConfigSignature() {
  return `${settingsStore.useMock ? 'mock' : 'live'}:${activeServerUrl.value}`
}

function isLoopbackUrl(url: string): boolean {
  return /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(url)
}

function handleGoSettings() {
  uni.navigateTo({
    url: '/pages/mine/settings',
  })
}

function promptBackendConfigModal(configSignature: string) {
  if (isConfigModalOpen || lastPromptedSignature === configSignature) {
    return
  }

  lastPromptedSignature = configSignature
  isConfigModalOpen = true

  const displayUrl = activeServerUrl.value || '未配置'
  const reasonTip = isLoopbackUrl(displayUrl)
    ? '当前后端地址指向本机回环地址 (127.0.0.1/localhost)，手机端或未启动本地服务时无法连接。'
    : '当前无法连接到后端服务或返回数据异常，已暂用本地离线示例展示。'

  uni.showModal({
    title: '网络或后端配置异常',
    content: `当前后端地址：${displayUrl}\n${reasonTip}请前往「个人设置」配置正确的后端 API 地址（或开启离线演示模式）。`,
    confirmText: '去设置',
    cancelText: '暂不设置',
    success: (res) => {
      isConfigModalOpen = false
      if (res.confirm) {
        handleGoSettings()
      }
    },
    fail: () => {
      isConfigModalOpen = false
    },
  })
}

async function loadFeatured(
  lib: LibraryType = activeFeaturedTab.value,
  options?: { forcePrompt?: boolean },
) {
  const currentVersion = ++requestVersion
  const configSignature = getConfigSignature()
  lastLoadedSignature = configSignature
  loading.value = true

  let fellBack = false

  try {
    const res = await getGarments(
      {
        library: lib,
        page: 1,
        page_size: 6,
      },
      {
        hideErrorToast: true,
        onFallback: () => {
          fellBack = true
        },
      },
    )

    if (currentVersion !== requestVersion) {
      return
    }

    featuredGarments.value = res.list
    networkIssueVisible.value = fellBack

    if (fellBack) {
      if (options?.forcePrompt) {
        lastPromptedSignature = ''
      }
      promptBackendConfigModal(configSignature)
    }
    else {
      lastPromptedSignature = ''
    }
  }
  finally {
    if (currentVersion === requestVersion) {
      loading.value = false
    }
  }
}

function handleSwitchTab(tab: LibraryType) {
  if (activeFeaturedTab.value === tab)
    return
  activeFeaturedTab.value = tab
  loadFeatured(tab)
}

function handleGoGallery(library: 'real' | 'anime' = 'real', query?: string) {
  uni.setStorageSync('nvzhuang:gallery:preferred_lib', library)
  if (query) {
    uni.setStorageSync('nvzhuang:gallery:preferred_q', query)
  }
  uni.switchTab({
    url: '/pages/gallery/index',
  })
}

function handleGoTryon() {
  uni.switchTab({
    url: '/pages/tryon/index',
  })
}

function handleGoMine() {
  uni.switchTab({
    url: '/pages/mine/index',
  })
}

function handleGoModels() {
  uni.navigateTo({
    url: '/pages/models/index',
  })
}

function handleGoKnowledge(category?: string) {
  const url = category ? `/pages/knowledge/index?category=${encodeURIComponent(category)}` : '/pages/knowledge/index'
  uni.navigateTo({
    url,
  })
}

function handleGoKnowledgeDetail(article: KnowledgeArticle) {
  uni.navigateTo({
    url: `/pages/knowledge/detail?id=${encodeURIComponent(article.id)}`,
  })
}

onMounted(() => {
  hasMounted = true
  loadFeatured('real')
  featuredArticles.value = getFeaturedKnowledgeArticles().slice(0, 3)
})

onShow(() => {
  if (!hasMounted) {
    return
  }
  const currentSignature = getConfigSignature()
  if (currentSignature !== lastLoadedSignature || networkIssueVisible.value) {
    loadFeatured(activeFeaturedTab.value)
  }
})
</script>

<template>
  <view class="page-container">
    <view class="status-bar-placeholder pt-safe" />

    <view class="content-scroller">
      <!-- 品牌头部 Header -->
      <view class="brand-header">
        <view class="brand-word">
          <view class="brand-badge">
            <text class="brand-badge-text">拍</text>
          </view>
          <view class="brand-sub">
            <text class="brand-title">拍片哥女装</text>
            <text class="brand-tag">写实 · 二次元 · AI 试衣画报</text>
          </view>
        </view>
        <view class="header-right">
          <view class="round-icon-btn mr-2" @tap="handleGoKnowledge()">
            <view class="i-carbon-book text-16px text-#382e32" />
          </view>
          <view class="round-icon-btn" @tap="handleGoMine">
            <view class="i-carbon-user text-17px text-#382e32" />
          </view>
        </view>
      </view>

      <!-- 网络或后端配置异常提示横幅 -->
      <view v-if="networkIssueVisible && !settingsStore.useMock" class="network-alert-banner">
        <view class="network-alert-main">
          <view class="network-alert-icon">
            <view class="i-carbon-warning-alt text-16px text-#c94f65" />
          </view>
          <view class="network-alert-copy">
            <text class="network-alert-title">后端服务暂未连接，当前展示离线示例</text>
            <text class="network-alert-url">当前地址：{{ activeServerUrl || '未配置' }}</text>
          </view>
        </view>
        <view class="network-alert-actions">
          <view class="network-alert-btn secondary" @tap="loadFeatured(activeFeaturedTab, { forcePrompt: true })">
            <view class="i-carbon-renew text-12px" />
            <text>重试</text>
          </view>
          <view class="network-alert-btn primary" @tap="handleGoSettings">
            <view class="i-carbon-settings text-12px" />
            <text>去设置</text>
          </view>
        </view>
      </view>

      <!-- 灵感 Hero Banner -->
      <view class="hero-card">
        <view class="hero-copy">
          <text class="hero-kicker">REAL & ANIME · 2727 LOOKS</text>
          <view class="hero-title">
            喜欢的衣服<br>先穿上看看。
          </view>
          <text class="hero-subtitle">1407套写实 + 1320套二次元 · 一键换装</text>
          <view class="hero-btns">
            <view class="pill-dark-btn" @tap="handleGoTryon">
              <text>立即试穿</text>
              <view class="i-carbon-arrow-right text-12px" />
            </view>
            <view class="pill-outline-btn" @tap="handleGoKnowledge()">
              <text>穿搭指南</text>
            </view>
          </view>
        </view>
        <view class="hero-art">
          <image
            src="https://paipiange.github.io/nvzhuang/assets/thumbs/SPR-0001.webp"
            mode="aspectFill"
            class="hero-art-img"
          />
        </view>
        <text class="hero-index">01 / 04</text>
      </view>

      <!-- 搜索栏入口 -->
      <view class="search-faux" @tap="handleGoGallery(activeFeaturedTab)">
        <view class="i-carbon-search text-15px text-#9d9394" />
        <text class="search-placeholder">搜索款式、二次元、Lolita、制服或关键词</text>
        <view class="search-end">
          <view class="i-carbon-filter text-14px text-#9d9394" />
        </view>
      </view>

      <!-- 快捷入口胶囊（4 项：写实女装 / 二次元穿搭 / AI 模特 / 知识手册） -->
      <view class="quick-cat">
        <view class="quick-btn" @tap="handleGoGallery('real')">
          <view class="quick-dot q-pink">
            ✿
          </view>
          <text class="quick-text">写实女装</text>
          <text class="quick-sub">1407 款</text>
        </view>
        <view class="quick-btn" @tap="handleGoGallery('anime')">
          <view class="quick-dot q-lav">
            ✦
            <text class="hot-badge">HOT</text>
          </view>
          <text class="quick-text">二次元穿搭</text>
          <text class="quick-sub">1320 款</text>
        </view>
        <view class="quick-btn" @tap="handleGoModels">
          <view class="quick-dot q-mocha">
            ◉
          </view>
          <text class="quick-text">AI 模特</text>
          <text class="quick-sub">1499 位</text>
        </view>
        <view class="quick-btn" @tap="handleGoKnowledge()">
          <view class="quick-dot q-amber">
            📖
            <text class="new-badge">NEW</text>
          </view>
          <text class="quick-text">知识手册</text>
          <text class="quick-sub">生图避坑</text>
        </view>
      </view>

      <!-- 二次元穿搭专区橱窗 Banner -->
      <view class="anime-showcase-card" @tap="handleGoGallery('anime')">
        <view class="anime-bg-glow" />
        <view class="anime-content">
          <view class="anime-tag-badge">
            <text class="star-icon">✦</text>
            <text>二次元动漫穿搭 · 破壁心动</text>
          </view>
          <view class="anime-h2">
            打破次元壁，<br>穿上梦中神装。
          </view>
          <text class="anime-sub">
            收录 1320 套纯动漫服饰 · 赛璐珞高光分层 · 完美贴合人体
          </text>

          <!-- 热门二次元风格快捷标签 -->
          <view class="anime-style-chips">
            <view
              class="anime-chip"
              @tap.stop="handleGoGallery('anime', 'frill')"
            >
              # 洛丽塔 (Lolita)
            </view>
            <view
              class="anime-chip"
              @tap.stop="handleGoGallery('anime', 'skirt')"
            >
              # JK制服
            </view>
            <view
              class="anime-chip"
              @tap.stop="handleGoGallery('anime', 'jacket')"
            >
              # 赛博机能
            </view>
            <view
              class="anime-chip"
              @tap.stop="handleGoGallery('anime', 'dress')"
            >
              # 仙侠新国风
            </view>
          </view>
        </view>
        <view class="anime-thumb-side">
          <image
            src="https://paipiange.github.io/nvzhuang/assets/anime/thumbs/SPR-0001.webp"
            mode="aspectFill"
            class="anime-thumb-img"
          />
          <view class="anime-go-btn">
            进入专区 ➔
          </view>
        </view>
      </view>

      <!-- 标题栏与双 Tab 切换：今日灵感 (写实甄选 vs 二次元穿搭) -->
      <view class="section-title">
        <view class="title-left">
          <text class="section-small">EDITOR'S PICKS</text>
          <view class="dual-tabs">
            <view
              class="tab-btn"
              :class="{ active: activeFeaturedTab === 'real' }"
              @tap="handleSwitchTab('real')"
            >
              写实甄选 (1407)
            </view>
            <view
              class="tab-btn tab-anime"
              :class="{ active: activeFeaturedTab === 'anime' }"
              @tap="handleSwitchTab('anime')"
            >
              二次元穿搭 (1320)
            </view>
          </view>
        </view>
        <view class="section-more-btn" @tap="handleGoGallery(activeFeaturedTab)">
          <text>全部{{ activeFeaturedTab === 'real' ? '写实' : '动漫' }}</text>
          <view class="i-carbon-chevron-right text-13px" />
        </view>
      </view>

      <!-- 双列精选穿搭网格 -->
      <view class="looks-grid">
        <GarmentCard
          v-for="garment in featuredGarments"
          :key="garment.id"
          :garment="garment"
        />
      </view>

      <!-- 知识库精选推荐模块 -->
      <view class="knowledge-home-section">
        <view class="section-title">
          <view>
            <text class="section-small">AI FASHION KNOWLEDGE</text>
            <view class="section-h3">
              穿搭与生图知识库 <text class="section-accent">✦</text>
            </view>
          </view>
          <view class="section-more-btn" @tap="handleGoKnowledge()">
            <text>全部手册</text>
            <view class="i-carbon-chevron-right text-13px" />
          </view>
        </view>

        <!-- 知识库精选卡片滑动列表 -->
        <scroll-view scroll-x class="kb-cards-scroll" :show-scrollbar="false">
          <view class="kb-cards-row">
            <view
              v-for="art in featuredArticles"
              :key="art.id"
              class="kb-home-card"
              @tap="handleGoKnowledgeDetail(art)"
            >
              <image :src="art.coverImage" mode="aspectFill" class="kb-card-thumb" />
              <view class="kb-card-info">
                <view class="kb-card-meta">
                  <text class="kb-card-cat">{{ art.categoryZh }}</text>
                  <text class="kb-card-time">{{ art.readTime }}</text>
                </view>
                <view class="kb-card-title">
                  {{ art.title }}
                </view>
                <text class="kb-card-sub">{{ art.subtitle }}</text>
                <view class="kb-read-link">
                  阅读指南 ➔
                </view>
              </view>
            </view>
          </view>
        </scroll-view>
      </view>

      <!-- 底部引流试穿卡片 -->
      <view class="mini-callout" @tap="handleGoTryon">
        <text class="callout-star">✧</text>
        <view class="callout-text">
          <text class="callout-title">不只是看，试试穿在自己身上</text>
          <text class="callout-sub">选一件衣服，即刻开启 AI 换装体验</text>
        </view>
        <view class="callout-arrow">
          <view class="i-carbon-chevron-right text-14px text-#cc8c9b" />
        </view>
      </view>

      <!-- 留白防止被底栏遮挡 -->
      <view class="h-28" />
    </view>

    <!-- 底部导航栏 -->
    <fg-tabbar />
  </view>
</template>

<style scoped lang="scss">
.page-container {
  min-height: 100vh;
  background-color: #fcfbfa;
  color: #272225;
}

.content-scroller {
  padding: 0 32rpx 40rpx;
}

/* 品牌头部 */
.brand-header {
  height: 120rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand-word {
  display: flex;
  align-items: center;
  gap: 18rpx;
}

.brand-badge {
  width: 68rpx;
  height: 68rpx;
  border-radius: 20rpx;
  background: linear-gradient(135deg, #c66e84 0%, #8e3b52 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4rpx 12rpx rgba(198, 110, 132, 0.28);
}

.brand-badge-text {
  color: #ffffff;
  font-size: 34rpx;
  font-weight: 900;
  line-height: 1;
}

.brand-sub {
  display: flex;
  flex-direction: column;
}

.brand-title {
  font-size: 32rpx;
  font-weight: 900;
  letter-spacing: -0.5rpx;
  line-height: 1.15;
  color: #272225;
}

.brand-tag {
  font-size: 18rpx;
  letter-spacing: 1.5rpx;
  font-weight: 700;
  color: #9a6f7b;
  margin-top: 4rpx;
}

.header-right {
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
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.04);

  &:active {
    transform: scale(0.95);
  }
}

/* 网络配置异常提示横幅 */
.network-alert-banner {
  background: #fff5f6;
  border: 1px solid #f4c7d0;
  border-radius: 22rpx;
  padding: 18rpx 20rpx;
  margin-bottom: 18rpx;
  display: flex;
  flex-direction: column;
  gap: 14rpx;
  box-shadow: 0 4rpx 14rpx rgba(201, 79, 101, 0.08);
}

.network-alert-main {
  display: flex;
  align-items: flex-start;
  gap: 14rpx;
}

.network-alert-icon {
  width: 44rpx;
  height: 44rpx;
  border-radius: 14rpx;
  background: #fde8ec;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.network-alert-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.network-alert-title {
  font-size: 22rpx;
  font-weight: 700;
  color: #8f2d43;
  line-height: 1.35;
}

.network-alert-url {
  font-size: 18rpx;
  color: #9e6a76;
  word-break: break-all;
  line-height: 1.35;
}

.network-alert-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12rpx;
}

.network-alert-btn {
  display: inline-flex;
  align-items: center;
  gap: 6rpx;
  padding: 10rpx 20rpx;
  border-radius: 999rpx;
  font-size: 20rpx;
  font-weight: 600;

  &.secondary {
    background: #ffffff;
    color: #7d5b63;
    border: 1px solid #e7cfd4;
  }

  &.primary {
    background: #cd7188;
    color: #ffffff;
  }

  &:active {
    opacity: 0.85;
  }
}

/* Hero Banner */
.hero-card {
  height: 420rpx;
  position: relative;
  overflow: hidden;
  border-radius: 34rpx;
  background: linear-gradient(125deg, #f2e7e6, #f0dadc 67%, #e9d0d3);
  margin-top: 6rpx;
}

.hero-copy {
  position: absolute;
  z-index: 3;
  left: 36rpx;
  top: 36rpx;
  max-width: 440rpx;
}

.hero-kicker {
  font-size: 16rpx;
  font-weight: 700;
  letter-spacing: 2rpx;
  color: #9a6f7b;
}

.hero-title {
  font-size: 40rpx;
  line-height: 1.25;
  letter-spacing: -1rpx;
  margin: 14rpx 0 10rpx;
  font-weight: 800;
  color: #382e32;
}

.hero-subtitle {
  font-size: 20rpx;
  color: #966e77;
  display: block;
  margin-bottom: 22rpx;
}

.hero-btns {
  display: flex;
  gap: 12rpx;
  align-items: center;
}

.pill-dark-btn {
  background: #373036;
  color: #ffffff;
  border-radius: 80rpx;
  padding: 14rpx 24rpx;
  font-size: 20rpx;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 12rpx;
  box-shadow: 0 4rpx 14rpx rgba(55, 48, 54, 0.2);

  &:active {
    transform: scale(0.97);
  }
}

.pill-outline-btn {
  background: rgba(255, 255, 255, 0.6);
  color: #5d4f54;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 80rpx;
  padding: 14rpx 22rpx;
  font-size: 20rpx;
  font-weight: 600;

  &:active {
    transform: scale(0.97);
  }
}

.hero-art {
  position: absolute;
  right: -40rpx;
  top: 30rpx;
  width: 370rpx;
  height: 420rpx;
  transform: rotate(-4deg);
  border-radius: 190rpx 190rpx 0 0;
  overflow: hidden;
  background: #f6efec;
  box-shadow: 0 0 0 20rpx rgba(255, 255, 255, 0.3);
}

.hero-art-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 50% 35%;
}

.hero-index {
  position: absolute;
  z-index: 4;
  bottom: 24rpx;
  left: 38rpx;
  font-size: 18rpx;
  color: #986c79;
  letter-spacing: 2rpx;
}

/* 伪搜索栏 */
.search-faux {
  height: 78rpx;
  border-radius: 22rpx;
  background: #f4f1f0;
  display: flex;
  align-items: center;
  gap: 16rpx;
  color: #9d9394;
  font-size: 22rpx;
  padding: 0 24rpx;
  margin: 24rpx 0;
}

.search-placeholder {
  flex: 1;
}

.search-end {
  margin-left: auto;
}

/* 快捷分类 */
.quick-cat {
  display: flex;
  justify-content: space-between;
  gap: 12rpx;
  margin-bottom: 32rpx;
}

.quick-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-weight: 650;
  font-size: 20rpx;
  gap: 8rpx;
  flex: 1;
  color: #453c3e;
}

.quick-dot {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40rpx;
  font-weight: 400;
  box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.04);
  position: relative;
}

.quick-sub {
  font-size: 16rpx;
  color: #a89fa1;
  font-weight: 400;
}

.q-pink {
  background: #fce9ed;
  color: #cc8291;
}

.q-lav {
  background: #f0eafb;
  color: #9333ea;
}

.q-mocha {
  background: #f2e9e2;
  color: #bc948a;
}

.q-amber {
  background: #fef3c7;
  color: #d97706;
}

.hot-badge {
  position: absolute;
  top: -6rpx;
  right: -8rpx;
  background: #ef4444;
  color: #ffffff;
  font-size: 14rpx;
  font-weight: 800;
  padding: 2rpx 8rpx;
  border-radius: 100rpx;
}

.new-badge {
  position: absolute;
  top: -6rpx;
  right: -8rpx;
  background: #f59e0b;
  color: #ffffff;
  font-size: 14rpx;
  font-weight: 800;
  padding: 2rpx 8rpx;
  border-radius: 100rpx;
}

/* 二次元专区特色 Showcase Banner */
.anime-showcase-card {
  position: relative;
  background: linear-gradient(135deg, #2e1c3b 0%, #4a284e 60%, #5d3257 100%);
  border-radius: 28rpx;
  padding: 30rpx;
  color: #ffffff;
  display: flex;
  overflow: hidden;
  margin-bottom: 34rpx;
  box-shadow: 0 10rpx 28rpx rgba(62, 32, 70, 0.2);
}

.anime-bg-glow {
  position: absolute;
  top: -60rpx;
  right: -60rpx;
  width: 240rpx;
  height: 240rpx;
  background: radial-gradient(circle, rgba(236, 72, 153, 0.35) 0%, transparent 70%);
  border-radius: 50%;
  pointer-events: none;
}

.anime-content {
  flex: 1;
  z-index: 2;
}

.anime-tag-badge {
  display: inline-flex;
  align-items: center;
  gap: 8rpx;
  background: rgba(236, 72, 153, 0.2);
  border: 1px solid rgba(236, 72, 153, 0.4);
  padding: 4rpx 14rpx;
  border-radius: 100rpx;
  font-size: 20rpx;
  color: #f472b6;
  margin-bottom: 12rpx;
}

.star-icon {
  font-size: 18rpx;
}

.anime-h2 {
  font-size: 34rpx;
  font-weight: 800;
  line-height: 1.3;
  margin-bottom: 8rpx;
}

.anime-sub {
  font-size: 20rpx;
  color: #e2d3e4;
  display: block;
  line-height: 1.45;
  margin-bottom: 16rpx;
}

.anime-style-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
}

.anime-chip {
  background: rgba(255, 255, 255, 0.12);
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
  font-size: 18rpx;
  color: #fce7f3;
}

.anime-thumb-side {
  width: 160rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  z-index: 2;
}

.anime-thumb-img {
  width: 140rpx;
  height: 180rpx;
  border-radius: 16rpx;
  background: #47324c;
  box-shadow: 0 6rpx 16rpx rgba(0, 0, 0, 0.25);
}

.anime-go-btn {
  font-size: 18rpx;
  color: #f9a8d4;
  font-weight: 600;
}

/* 标题区与 Dual Tabs */
.section-title {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 24rpx;
}

.title-left {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
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
  letter-spacing: -0.6rpx;
  color: #272225;
}

.section-accent {
  color: #cf8391;
}

.dual-tabs {
  display: flex;
  background: #f0ebec;
  border-radius: 100rpx;
  padding: 6rpx;
  gap: 6rpx;
}

.tab-btn {
  padding: 10rpx 20rpx;
  border-radius: 100rpx;
  font-size: 22rpx;
  font-weight: 600;
  color: #72676a;
  transition: all 0.2s ease;

  &.active {
    background: #ffffff;
    color: #272225;
    box-shadow: 0 4rpx 10rpx rgba(0, 0, 0, 0.05);
  }

  &.tab-anime.active {
    background: linear-gradient(135deg, #9333ea 0%, #c026d3 100%);
    color: #ffffff;
  }
}

.section-more-btn {
  display: flex;
  align-items: center;
  gap: 4rpx;
  color: #a49a9a;
  font-size: 20rpx;
  padding: 12rpx 0;
}

/* 双列网格 */
.looks-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 26rpx 20rpx;
}

/* 知识库精选模块 */
.knowledge-home-section {
  margin-top: 40rpx;
}

.kb-cards-scroll {
  white-space: nowrap;
}

.kb-cards-row {
  display: inline-flex;
  gap: 20rpx;
  padding: 4rpx 0;
}

.kb-home-card {
  width: 480rpx;
  background: #ffffff;
  border-radius: 20rpx;
  overflow: hidden;
  box-shadow: 0 6rpx 18rpx rgba(0, 0, 0, 0.03);
  border: 1px solid rgba(0, 0, 0, 0.04);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}

.kb-card-thumb {
  width: 100%;
  height: 220rpx;
  background: #ebe5e7;
}

.kb-card-info {
  padding: 20rpx;
  display: flex;
  flex-direction: column;
}

.kb-card-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8rpx;
}

.kb-card-cat {
  font-size: 18rpx;
  font-weight: 700;
  color: #cd657b;
  background: rgba(205, 101, 123, 0.08);
  padding: 2rpx 8rpx;
  border-radius: 4rpx;
}

.kb-card-time {
  font-size: 18rpx;
  color: #9d9394;
}

.kb-card-title {
  font-size: 26rpx;
  font-weight: 700;
  color: #272225;
  white-space: normal;
  line-height: 1.35;
  margin-bottom: 6rpx;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.kb-card-sub {
  font-size: 20rpx;
  color: #72676a;
  white-space: normal;
  line-height: 1.45;
  margin-bottom: 12rpx;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.kb-read-link {
  font-size: 20rpx;
  font-weight: 600;
  color: #cd657b;
}

/* 底部引导栏 */
.mini-callout {
  display: flex;
  background: #f8eff0;
  border-radius: 24rpx;
  padding: 24rpx 22rpx;
  align-items: center;
  gap: 18rpx;
  margin-top: 36rpx;
}

.callout-star {
  font-size: 40rpx;
  color: #cc8c9b;
}

.callout-text {
  flex: 1;
}

.callout-title {
  font-size: 20rpx;
  font-weight: 700;
  color: #382e32;
  display: block;
}

.callout-sub {
  font-size: 18rpx;
  color: #a99d9e;
  display: block;
  margin-top: 6rpx;
}
</style>
