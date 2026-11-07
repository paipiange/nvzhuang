<script lang="ts" setup>
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { KnowledgeArticle, KnowledgeCategory } from '@/types/knowledge'
import { getKnowledgeArticles, KNOWLEDGE_CATEGORIES } from '@/data/knowledge'

defineOptions({
  name: 'KnowledgeIndexPage',
})

definePage({
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '穿搭与生图知识库',
  },
})

const activeCategory = ref<KnowledgeCategory>('all')
const searchKeyword = ref('')
const categories = ref(KNOWLEDGE_CATEGORIES)

const allArticles = ref<KnowledgeArticle[]>([])

function loadArticles() {
  allArticles.value = getKnowledgeArticles(activeCategory.value)
}

const filteredArticles = computed(() => {
  let list = allArticles.value
  if (searchKeyword.value.trim()) {
    const q = searchKeyword.value.trim().toLowerCase()
    list = list.filter(item =>
      item.title.toLowerCase().includes(q)
      || item.subtitle.toLowerCase().includes(q)
      || item.summary.toLowerCase().includes(q)
      || item.tags.some(t => t.toLowerCase().includes(q)),
    )
  }
  return list
})

const featuredArticles = computed(() => {
  return allArticles.value.filter(a => a.featured)
})

function handleSelectCategory(cat: KnowledgeCategory) {
  activeCategory.value = cat
  loadArticles()
}

function handleGoDetail(article: KnowledgeArticle) {
  uni.navigateTo({
    url: `/pages/knowledge/detail?id=${encodeURIComponent(article.id)}`,
  })
}

function handleGoBack() {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack()
  }
  else {
    uni.switchTab({
      url: '/pages/index/index',
    })
  }
}

function handleGoGallery(lib: 'real' | 'anime') {
  uni.setStorageSync('nvzhuang:gallery:preferred_lib', lib)
  uni.switchTab({
    url: '/pages/gallery/index',
  })
}

function handleGoTryon() {
  uni.switchTab({
    url: '/pages/tryon/index',
  })
}

onLoad((options: any) => {
  if (options && options.category) {
    activeCategory.value = options.category as KnowledgeCategory
  }
  loadArticles()
})
</script>

<template>
  <view class="knowledge-page">
    <view class="status-bar-placeholder pt-safe" />

    <view class="screen-scroller">
      <!-- 顶部导航条 -->
      <view class="top-nav">
        <view class="back-btn" @tap="handleGoBack">
          <view class="i-carbon-arrow-left text-18px text-#272225" />
        </view>
        <view class="nav-titles">
          <text class="brand-sub">拍片哥女装 · KNOWLEDGE</text>
          <text class="nav-main">穿搭与生图知识库</text>
        </view>
        <view class="w-36px" />
      </view>

      <!-- 顶部 Banner 卡片 -->
      <view class="hero-card">
        <view class="hero-badge">
          ✦ 穿搭与生图秘籍
        </view>
        <view class="hero-h1">
          让每一套服装，<br>都能惊艳出片。
        </view>
        <text class="hero-desc">
          涵盖 1320 套二次元服饰风格、AI 换装避坑秘籍、中英双语提示词词典与 ControlNet 姿势联动。
        </text>
        <view class="hero-stats">
          <view class="stat-pill">
            <text class="stat-num">2727</text> 套服饰体系
          </view>
          <view class="stat-pill">
            <text class="stat-num">1499</text> 位 AI 模特
          </view>
          <view class="stat-pill">
            <text class="stat-num">100%</text> 实用干货
          </view>
        </view>
      </view>

      <!-- 搜索栏 -->
      <view class="searchbar">
        <view class="i-carbon-search text-15px text-#9d9394" />
        <input
          v-model="searchKeyword"
          type="text"
          placeholder="搜索知识库：二次元、换装避坑、提示词..."
          placeholder-class="search-ph"
          class="search-input"
        >
        <view
          v-if="searchKeyword"
          class="i-carbon-close text-14px text-#999"
          @tap="searchKeyword = ''"
        />
      </view>

      <!-- 分类标签滑动栏 -->
      <scroll-view scroll-x class="category-scroll" :show-scrollbar="false">
        <view class="chips-row">
          <view
            v-for="cat in categories"
            :key="cat.key"
            class="chip"
            :class="{ active: activeCategory === cat.key }"
            @tap="handleSelectCategory(cat.key)"
          >
            <text class="chip-icon">{{ cat.icon }}</text>
            <text class="chip-text">{{ cat.name }}</text>
          </view>
        </view>
      </scroll-view>

      <!-- 精选推荐文章 (仅在全部模式且无搜索时展示) -->
      <view v-if="activeCategory === 'all' && !searchKeyword && featuredArticles.length > 0" class="featured-section">
        <view class="section-title">
          <view>
            <text class="section-small">FEATURED GUIDES</text>
            <view class="section-h3">
              重磅推荐 ✳
            </view>
          </view>
        </view>

        <!-- 推荐大卡片 -->
        <view
          v-for="item in featuredArticles.slice(0, 2)"
          :key="item.id"
          class="featured-big-card"
          @tap="handleGoDetail(item)"
        >
          <image :src="item.coverImage" mode="aspectFill" class="big-cover" />
          <view class="big-info">
            <view class="big-meta">
              <text class="cat-tag">{{ item.categoryZh }}</text>
              <text class="read-time">{{ item.readTime }}阅读</text>
            </view>
            <view class="big-title">
              {{ item.title }}
            </view>
            <text class="big-sub">{{ item.subtitle }}</text>
            <view class="tags-row">
              <text v-for="tag in item.tags.slice(0, 3)" :key="tag" class="tag-pill"># {{ tag }}</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 文章列表 -->
      <view class="section-title mt-4">
        <view>
          <text class="section-small">ARTICLES & LEXICON</text>
          <view class="section-h3">
            {{ activeCategory === 'all' ? '全部专题' : categories.find(c => c.key === activeCategory)?.name }}
            <text class="text-12px text-#8e8488 font-normal">({{ filteredArticles.length }}篇)</text>
          </view>
        </view>
      </view>

      <view v-if="filteredArticles.length > 0" class="articles-list">
        <view
          v-for="article in filteredArticles"
          :key="article.id"
          class="article-card"
          @tap="handleGoDetail(article)"
        >
          <image :src="article.coverImage" mode="aspectFill" class="card-thumb" />
          <view class="card-body">
            <view class="card-meta">
              <text class="cat-pill">{{ article.categoryZh }}</text>
              <text class="read-info">{{ article.readTime }}</text>
            </view>
            <view class="card-title">
              {{ article.title }}
            </view>
            <text class="card-summary">{{ article.summary }}</text>
            <view class="card-tags">
              <text v-for="tag in article.tags.slice(0, 3)" :key="tag" class="tag-mini">#{{ tag }}</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 空态 -->
      <view v-else class="empty-box">
        <view class="empty-icon">
          🔍
        </view>
        <text class="empty-title">未找到相关知识库文章</text>
        <text class="empty-sub">换个搜索词或点击上方分类看看吧</text>
      </view>

      <!-- 底部快捷通道 -->
      <view class="footer-links">
        <view class="link-card link-anime" @tap="handleGoGallery('anime')">
          <view class="link-icon">
            ✦
          </view>
          <view class="link-info">
            <text class="link-title">二次元动漫穿搭专区</text>
            <text class="link-sub">1320 套插画级服装探索 ➔</text>
          </view>
        </view>

        <view class="link-card link-tryon" @tap="handleGoTryon">
          <view class="link-icon">
            🪄
          </view>
          <view class="link-info">
            <text class="link-title">前往 AI 虚拟试衣间</text>
            <text class="link-sub">立即上身体验心动穿搭 ➔</text>
          </view>
        </view>
      </view>

      <view class="h-20" />
    </view>
  </view>
</template>

<style scoped lang="scss">
.knowledge-page {
  min-height: 100vh;
  background-color: #fcfbfa;
  color: #272225;
}

.screen-scroller {
  padding: 0 32rpx 40rpx;
}

.top-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16rpx 0 24rpx;
}

.back-btn {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.04);
  display: flex;
  align-items: center;
  justify-content: center;
}

.nav-titles {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.brand-sub {
  font-size: 20rpx;
  letter-spacing: 2rpx;
  color: #9d9394;
  font-weight: 600;
}

.nav-main {
  font-size: 32rpx;
  font-weight: 700;
  color: #272225;
}

.hero-card {
  background: linear-gradient(135deg, #2b2427 0%, #3e3237 100%);
  border-radius: 28rpx;
  padding: 36rpx;
  color: #ffffff;
  position: relative;
  overflow: hidden;
  margin-bottom: 28rpx;
  box-shadow: 0 12rpx 32rpx rgba(43, 36, 39, 0.12);

  &::after {
    content: '';
    position: absolute;
    right: -40rpx;
    bottom: -40rpx;
    width: 220rpx;
    height: 220rpx;
    background: radial-gradient(circle, rgba(205, 101, 123, 0.3) 0%, transparent 70%);
    border-radius: 50%;
  }
}

.hero-badge {
  display: inline-block;
  padding: 6rpx 16rpx;
  background: rgba(205, 101, 123, 0.25);
  border: 1px solid rgba(205, 101, 123, 0.4);
  border-radius: 100rpx;
  font-size: 22rpx;
  color: #f7b4c4;
  margin-bottom: 16rpx;
}

.hero-h1 {
  font-size: 40rpx;
  font-weight: 700;
  line-height: 1.35;
  margin-bottom: 14rpx;
}

.hero-desc {
  font-size: 24rpx;
  color: #ded7da;
  line-height: 1.6;
  margin-bottom: 24rpx;
  display: block;
}

.hero-stats {
  display: flex;
  gap: 16rpx;
  flex-wrap: wrap;
}

.stat-pill {
  background: rgba(255, 255, 255, 0.1);
  padding: 8rpx 18rpx;
  border-radius: 12rpx;
  font-size: 22rpx;
  color: #f5edef;
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.stat-num {
  font-weight: 700;
  color: #f7b4c4;
}

.searchbar {
  display: flex;
  align-items: center;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 20rpx;
  padding: 18rpx 24rpx;
  margin-bottom: 24rpx;
  gap: 14rpx;
  box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.02);
}

.search-input {
  flex: 1;
  font-size: 26rpx;
  color: #272225;
}

.search-ph {
  color: #a89fa1;
}

.category-scroll {
  white-space: nowrap;
  margin-bottom: 28rpx;
}

.chips-row {
  display: flex;
  gap: 16rpx;
  padding: 4rpx 0;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 10rpx;
  padding: 14rpx 26rpx;
  border-radius: 100rpx;
  background: #f2eeef;
  color: #63585b;
  font-size: 24rpx;
  font-weight: 500;
  transition: all 0.2s ease;
  flex-shrink: 0;

  &.active {
    background: #cd657b;
    color: #ffffff;
    box-shadow: 0 6rpx 18rpx rgba(205, 101, 123, 0.3);
  }
}

.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20rpx;
}

.section-small {
  font-size: 20rpx;
  font-weight: 700;
  letter-spacing: 2rpx;
  color: #a89ea2;
}

.section-h3 {
  font-size: 34rpx;
  font-weight: 700;
  color: #272225;
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.featured-big-card {
  background: #ffffff;
  border-radius: 24rpx;
  overflow: hidden;
  margin-bottom: 24rpx;
  box-shadow: 0 8rpx 24rpx rgba(0, 0, 0, 0.04);
  border: 1px solid rgba(0, 0, 0, 0.04);
}

.big-cover {
  width: 100%;
  height: 320rpx;
  background: #eae5e7;
}

.big-info {
  padding: 24rpx;
}

.big-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12rpx;
}

.cat-tag {
  background: rgba(205, 101, 123, 0.1);
  color: #cd657b;
  padding: 4rpx 14rpx;
  border-radius: 8rpx;
  font-size: 22rpx;
  font-weight: 600;
}

.read-time {
  font-size: 22rpx;
  color: #9d9394;
}

.big-title {
  font-size: 32rpx;
  font-weight: 700;
  color: #272225;
  line-height: 1.4;
  margin-bottom: 8rpx;
}

.big-sub {
  font-size: 24rpx;
  color: #63585b;
  line-height: 1.5;
  margin-bottom: 16rpx;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.tags-row {
  display: flex;
  gap: 12rpx;
  flex-wrap: wrap;
}

.tag-pill {
  font-size: 20rpx;
  color: #8b7f83;
  background: #f7f3f4;
  padding: 4rpx 14rpx;
  border-radius: 8rpx;
}

.articles-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.article-card {
  display: flex;
  background: #ffffff;
  border-radius: 20rpx;
  padding: 20rpx;
  gap: 20rpx;
  box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.03);
  border: 1px solid rgba(0, 0, 0, 0.03);
}

.card-thumb {
  width: 180rpx;
  height: 220rpx;
  border-radius: 14rpx;
  background: #eae5e7;
  flex-shrink: 0;
}

.card-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
}

.card-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.cat-pill {
  font-size: 20rpx;
  font-weight: 600;
  color: #cd657b;
  background: rgba(205, 101, 123, 0.08);
  padding: 2rpx 10rpx;
  border-radius: 6rpx;
}

.read-info {
  font-size: 20rpx;
  color: #9d9394;
}

.card-title {
  font-size: 28rpx;
  font-weight: 700;
  color: #272225;
  line-height: 1.35;
  margin-top: 6rpx;
  margin-bottom: 6rpx;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-summary {
  font-size: 22rpx;
  color: #72676a;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 8rpx;
}

.card-tags {
  display: flex;
  gap: 8rpx;
}

.tag-mini {
  font-size: 18rpx;
  color: #9d9394;
}

.empty-box {
  padding: 80rpx 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.empty-icon {
  font-size: 56rpx;
  margin-bottom: 16rpx;
}

.empty-title {
  font-size: 28rpx;
  font-weight: 600;
  color: #3e3237;
  margin-bottom: 8rpx;
}

.empty-sub {
  font-size: 22rpx;
  color: #9d9394;
}

.footer-links {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  margin-top: 36rpx;
}

.link-card {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 24rpx;
  border-radius: 20rpx;
  box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.03);

  &.link-anime {
    background: linear-gradient(135deg, #f3ebfc 0%, #faeef6 100%);
    border: 1px solid rgba(168, 85, 247, 0.15);

    .link-icon {
      background: #9333ea;
      color: #ffffff;
    }

    .link-title {
      color: #6b21a8;
    }
  }

  &.link-tryon {
    background: linear-gradient(135deg, #fdf0f4 0%, #fef5ea 100%);
    border: 1px solid rgba(205, 101, 123, 0.15);

    .link-icon {
      background: #cd657b;
      color: #ffffff;
    }

    .link-title {
      color: #9f364d;
    }
  }
}

.link-icon {
  width: 68rpx;
  height: 68rpx;
  border-radius: 18rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  font-weight: 700;
}

.link-info {
  display: flex;
  flex-direction: column;
}

.link-title {
  font-size: 28rpx;
  font-weight: 700;
}

.link-sub {
  font-size: 22rpx;
  color: #7a6e72;
  margin-top: 4rpx;
}
</style>
