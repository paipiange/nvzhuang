<script lang="ts" setup>
import { computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useFavoritesStore } from '@/store/favorites'
import { useTryonStore } from '@/store/tryon'
import { MOCK_GARMENTS } from '@/mock/data'

defineOptions({
  name: 'MinePage',
})

definePage({
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '我的衣橱',
  },
})

const favoritesStore = useFavoritesStore()
const tryonStore = useTryonStore()

const favoriteCount = computed(() => {
  const c = favoritesStore.count
  return c < 10 ? `0${c}` : `${c}`
})

const historyCount = computed(() => {
  const c = tryonStore.history.length
  return c < 10 ? `0${c}` : `${c}`
})

const recentFavorites = computed(() => {
  const ids = favoritesStore.favoriteIds.slice(0, 3)
  return ids.map((id) => {
    const found = MOCK_GARMENTS.find(g => g.id === id)
    return found ? (found.thumbnail_url || found.image_url) : 'https://paipiange.github.io/nvzhuang/assets/thumbs/SPR-0001.webp'
  })
})

function handleGoFavorites() {
  uni.navigateTo({
    url: '/pages/mine/favorites',
  })
}

function handleGoHistory() {
  uni.navigateTo({
    url: '/pages/mine/history',
  })
}

function handleGoSettings() {
  uni.navigateTo({
    url: '/pages/mine/settings',
  })
}

function handleGoKnowledge() {
  uni.navigateTo({
    url: '/pages/knowledge/index',
  })
}

function handleGoGallery() {
  uni.switchTab({
    url: '/pages/gallery/index',
  })
}

onShow(() => {
  favoritesStore.init()
  tryonStore.initHistory()
})
</script>

<template>
  <view class="mine-page">
    <view class="status-bar-placeholder pt-safe" />

    <view class="screen-scroller">
      <!-- 标头 -->
      <view class="std-head">
        <view class="head-titles">
          <text class="eyebrow">拍片哥女装 · PAIPIANGE</text>
          <view class="main-title">
            我的衣橱
          </view>
          <text class="sub-title">喜欢的穿搭，都收藏在这里。</text>
        </view>
        <view class="round-icon-btn" @tap="handleGoSettings">
          <view class="i-carbon-settings text-17px text-#382e32" />
        </view>
      </view>

      <!-- 个人卡片 Profile -->
      <view class="profile-card">
        <view class="avatar">
          <text>拍</text>
        </view>
        <view class="profile-text">
          <text class="profile-title">拍片哥女装 · 试衣体验馆</text>
          <text class="profile-sub">每一种风格，都值得被尝试</text>
        </view>
        <view class="member-tag">
          PAIPIANGE
        </view>
      </view>

      <!-- 统计栏 -->
      <view class="profile-numbers">
        <view class="num-item" @tap="handleGoFavorites">
          <text class="num-val">{{ favoriteCount }}</text>
          <text class="num-label">我的收藏</text>
        </view>
        <view class="vert-line" />
        <view class="num-item" @tap="handleGoHistory">
          <text class="num-val">{{ historyCount }}</text>
          <text class="num-label">试穿记录</text>
        </view>
        <view class="vert-line" />
        <view class="num-item" @tap="handleGoGallery">
          <text class="num-val">2,727</text>
          <text class="num-label">灵感图库</text>
        </view>
      </view>

      <!-- 心动款模块 -->
      <view class="section-title">
        <view>
          <text class="section-small">MY FAVORITES</text>
          <view class="section-h3">
            我的心动款
          </view>
        </view>
        <view class="section-more-btn" @tap="handleGoFavorites">
          <text>全部</text>
          <view class="i-carbon-chevron-right text-13px" />
        </view>
      </view>

      <!-- 收藏缩略图列表 -->
      <view class="saved-items">
        <image
          v-for="(img, idx) in recentFavorites"
          :key="idx"
          :src="img"
          mode="aspectFill"
          class="saved-img"
          @tap="handleGoFavorites"
        />
        <view
          v-if="recentFavorites.length < 3"
          class="add-save"
          @tap="handleGoGallery"
        >
          <text class="add-plus">+</text>
          <text>去挑选</text>
        </view>
      </view>

      <!-- 菜单操作列表 -->
      <view class="mine-actions">
        <view class="menu-item" @tap="handleGoHistory">
          <view class="menu-ico m-pink">
            <view class="i-carbon-time text-17px" />
          </view>
          <view class="menu-text">
            <text class="menu-title">试穿记录</text>
            <text class="menu-sub">浏览你的换装作品</text>
          </view>
          <view class="i-carbon-chevron-right text-14px text-#a9a0a2" />
        </view>

        <view class="menu-item" @tap="handleGoFavorites">
          <view class="menu-ico m-lilac">
            <view class="i-carbon-favorite text-17px" />
          </view>
          <view class="menu-text">
            <text class="menu-title">我的收藏</text>
            <text class="menu-sub">保存喜欢的服装灵感</text>
          </view>
          <view class="i-carbon-chevron-right text-14px text-#a9a0a2" />
        </view>

        <view class="menu-item" @tap="handleGoKnowledge">
          <view class="menu-ico m-amber">
            <view class="i-carbon-book text-17px" />
          </view>
          <view class="menu-text">
            <text class="menu-title">穿搭与生图知识库</text>
            <text class="menu-sub">二次元穿搭 / 提示词词典 / 换装秘籍</text>
          </view>
          <view class="i-carbon-chevron-right text-14px text-#a9a0a2" />
        </view>

        <view class="menu-item" @tap="handleGoSettings">
          <view class="menu-ico m-caramel">
            <view class="i-carbon-settings text-17px" />
          </view>
          <view class="menu-text">
            <text class="menu-title">模型与服务设置</text>
            <text class="menu-sub">自建后端 / API Key / 调试环境</text>
          </view>
          <view class="i-carbon-chevron-right text-14px text-#a9a0a2" />
        </view>
      </view>

      <!-- 底部金句标牌 -->
      <view class="bottom-banner">
        <view class="banner-text">
          <text class="banner-title">拍片哥女装 · 为灵感而生</text>
          <text class="banner-sub">一千种风格，不止一种自己。</text>
        </view>
        <text class="banner-star">✳</text>
      </view>

      <view class="h-24" />
    </view>

    <!-- 底部 Tabbar -->
    <fg-tabbar />
  </view>
</template>

<style scoped lang="scss">
.mine-page {
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

.profile-card {
  display: flex;
  align-items: center;
  gap: 24rpx;
  background: linear-gradient(110deg, #f8eaed, #f8f1ef);
  padding: 28rpx;
  border-radius: 30rpx;
}

.avatar {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  background: linear-gradient(120deg, #d78294, #9f5b78);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: Georgia, serif;
  font-style: italic;
  font-size: 46rpx;
  letter-spacing: -6rpx;
  flex: 0 0 auto;

  span {
    font-size: 26rpx;
    margin-left: -10rpx;
  }
}

.profile-text {
  flex: 1;
  min-width: 0;
}

.profile-title {
  font-size: 26rpx;
  font-weight: 800;
  color: #272225;
  display: block;
  margin-bottom: 8rpx;
}

.profile-sub {
  color: #a98f96;
  font-size: 18rpx;
  white-space: nowrap;
  display: block;
}

.member-tag {
  font-size: 16rpx;
  color: #bb7389;
  border: 1px solid #e8c5cd;
  white-space: nowrap;
  border-radius: 40rpx;
  padding: 8rpx 14rpx;
  letter-spacing: 1rpx;
  font-weight: 700;
}

.profile-numbers {
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: 44rpx 8rpx 46rpx;
}

.num-item {
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 8rpx;
  min-width: 130rpx;
}

.num-val {
  font-size: 40rpx;
  font-weight: 800;
  letter-spacing: -1.4rpx;
  color: #272225;
}

.num-label {
  font-size: 20rpx;
  color: #a89fa0;
}

.vert-line {
  height: 54rpx;
  width: 1px;
  background: #eae4e3;
}

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
  color: #272225;
}

.section-more-btn {
  display: flex;
  align-items: center;
  gap: 4rpx;
  color: #a49a9a;
  font-size: 20rpx;
  padding: 12rpx 0;
}

.saved-items {
  display: flex;
  gap: 18rpx;
  margin-bottom: 50rpx;
}

.saved-img {
  width: 31%;
  height: 222rpx;
  object-fit: cover;
  border-radius: 20rpx;
}

.add-save {
  border-radius: 20rpx;
  border: 1px dashed #e3d7d8;
  color: #aa959b;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 14rpx;
  flex: 1;
  font-size: 20rpx;
  background: #fbf8f8;
}

.add-plus {
  font-size: 36rpx;
  font-weight: 400;
}

.mine-actions {
  border-radius: 28rpx;
  overflow: hidden;
  background: #ffffff;
  border: 1px solid #f4f0ef;
}

.menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  padding: 26rpx 24rpx;
  gap: 22rpx;
  border-bottom: 1px solid #f6f3f2;
  box-sizing: border-box;

  &:last-child {
    border-bottom: 0;
  }

  &:active {
    background: #fdfafb;
  }
}

.menu-text {
  flex: 1;
}

.menu-title {
  font-size: 22rpx;
  font-weight: 700;
  color: #272225;
  display: block;
  margin-bottom: 6rpx;
}

.menu-sub {
  font-size: 18rpx;
  color: #a89ea0;
  display: block;
}

.menu-ico {
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 68rpx;
  height: 68rpx;
}

.m-pink {
  color: #c5798a;
  background: #f7e8ec;
}

.m-lilac {
  color: #9c85b5;
  background: #f1edf7;
}

.m-caramel {
  color: #b08f7e;
  background: #f3ede7;
}

.m-amber {
  color: #d97706;
  background: #fef3c7;
}

.bottom-banner {
  background: #f7f3f0;
  border-radius: 24rpx;
  margin-top: 38rpx;
  padding: 30rpx 32rpx;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.banner-title {
  font-size: 22rpx;
  font-weight: 800;
  color: #382e32;
  display: block;
}

.banner-sub {
  font-size: 18rpx;
  color: #a99998;
  display: block;
  margin-top: 10rpx;
}

.banner-star {
  font-size: 54rpx;
  color: #d8acac;
}
</style>
