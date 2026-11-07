<script lang="ts" setup>
import { onMounted, ref } from 'vue'
import type { Garment } from '@/types/garment'
import { getGarments } from '@/api/garment'
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

const featuredGarments = ref<Garment[]>([])
const loading = ref(false)

async function loadFeatured() {
  loading.value = true
  try {
    const res = await getGarments({
      library: 'real',
      page: 1,
      page_size: 6,
    })
    featuredGarments.value = res.list
  }
  finally {
    loading.value = false
  }
}

function handleGoGallery(library: 'real' | 'anime' = 'real') {
  uni.setStorageSync('nvzhuang:gallery:preferred_lib', library)
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

onMounted(() => {
  loadFeatured()
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
            <text class="brand-tag">AI 智能试衣画报</text>
          </view>
        </view>
        <view class="round-icon-btn" @tap="handleGoMine">
          <view class="i-carbon-user text-17px text-#382e32" />
        </view>
      </view>

      <!-- 灵感 Hero Banner -->
      <view class="hero-card">
        <view class="hero-copy">
          <text class="hero-kicker">YOUR STYLE, REIMAGINED</text>
          <view class="hero-title">
            喜欢的衣服<br>先穿上看看。
          </view>
          <text class="hero-subtitle">发现灵感 · AI 一键试衣</text>
          <view class="pill-dark-btn" @tap="handleGoTryon">
            <text>立即试穿</text>
            <view class="i-carbon-arrow-right text-12px" />
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
      <view class="search-faux" @tap="handleGoGallery('real')">
        <view class="i-carbon-search text-15px text-#9d9394" />
        <text class="search-placeholder">搜索连衣裙、风格或颜色</text>
        <view class="search-end">
          <view class="i-carbon-filter text-14px text-#9d9394" />
        </view>
      </view>

      <!-- 快捷入口胶囊 -->
      <view class="quick-cat">
        <view class="quick-btn" @tap="handleGoGallery('real')">
          <view class="quick-dot q-pink">
            ✿
          </view>
          <text class="quick-text">写实女装</text>
        </view>
        <view class="quick-btn" @tap="handleGoGallery('anime')">
          <view class="quick-dot q-lav">
            ✦
          </view>
          <text class="quick-text">动漫服装</text>
        </view>
        <view class="quick-btn" @tap="handleGoModels">
          <view class="quick-dot q-mocha">
            ◉
          </view>
          <text class="quick-text">AI 模特</text>
        </view>
      </view>

      <!-- 标题栏：今日灵感 -->
      <view class="section-title">
        <view>
          <text class="section-small">EDITOR'S PICKS</text>
          <view class="section-h3">
            今日灵感 <text class="section-accent">✳</text>
          </view>
        </view>
        <view class="section-more-btn" @tap="handleGoGallery('real')">
          <text>查看全部</text>
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

      <!-- 底部引流试穿卡片 -->
      <view class="mini-callout" @tap="handleGoTryon">
        <text class="callout-star">✧</text>
        <view class="callout-text">
          <text class="callout-title">不只是看，试试穿在自己身上</text>
          <text class="callout-sub">选一件衣服，即刻开启 AI 试衣</text>
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
  letter-spacing: 2.2rpx;
  font-weight: 700;
  color: #9a6f7b;
  margin-top: 4rpx;
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

/* Hero Banner */
.hero-card {
  height: 414rpx;
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
  top: 40rpx;
}

.hero-kicker {
  font-size: 16rpx;
  font-weight: 700;
  letter-spacing: 2rpx;
  color: #9a6f7b;
}

.hero-title {
  font-size: 42rpx;
  line-height: 1.3;
  letter-spacing: -1rpx;
  margin: 18rpx 0 12rpx;
  font-weight: 800;
  color: #382e32;
}

.hero-subtitle {
  font-size: 20rpx;
  color: #966e77;
  display: block;
  margin-bottom: 24rpx;
}

.pill-dark-btn {
  background: #373036;
  color: #ffffff;
  border-radius: 80rpx;
  padding: 16rpx 28rpx;
  font-size: 20rpx;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 16rpx;
  box-shadow: 0 4rpx 14rpx rgba(55, 48, 54, 0.2);

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
  margin: 26rpx 0;
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
  gap: 8rpx;
  margin-bottom: 42rpx;
}

.quick-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-weight: 650;
  font-size: 20rpx;
  gap: 12rpx;
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
  font-size: 44rpx;
  font-weight: 400;
  box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.04);
}

.q-pink {
  background: #fce9ed;
  color: #cc8291;
}

.q-lav {
  background: #efebf7;
  color: #a591ca;
}

.q-mocha {
  background: #f2e9e2;
  color: #bc948a;
}

/* 标题区 */
.section-title {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 24rpx;
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
