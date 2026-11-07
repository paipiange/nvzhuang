<script lang="ts" setup>
import { onMounted, ref } from 'vue'
import { onPullDownRefresh, onReachBottom, onShow } from '@dcloudio/uni-app'
import type { Garment, GarmentCategory, LibraryType } from '@/types/garment'
import { getGarments } from '@/api/garment'
import { getCategories } from '@/api/catalog'
import { CATEGORIES } from '@/mock/data'
import GarmentCard from '@/components/GarmentCard.vue'
import CategoryChips from '@/components/CategoryChips.vue'
import EmptyState from '@/components/EmptyState.vue'

defineOptions({
  name: 'GalleryPage',
})

definePage({
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '探索衣橱',
    enablePullDownRefresh: true,
  },
})

const library = ref<LibraryType>('real')
const activeCategory = ref<GarmentCategory | 'all'>('all')
const searchKeyword = ref('')
const categoriesList = ref(CATEGORIES)

const animeStyles = [
  { name: '全部风格', keyword: '' },
  { name: '洛丽塔 (蕾丝)', keyword: 'frill' },
  { name: 'JK制服 (百褶)', keyword: 'skirt' },
  { name: '机能风 (外套)', keyword: 'jacket' },
  { name: '连衣裙 (长裙)', keyword: 'dress' },
  { name: '针织毛衫', keyword: 'knit' },
]

function handleSelectAnimeStyle(kw: string) {
  searchKeyword.value = kw
  loadData(true)
}

function handleGoKnowledge() {
  const category = library.value === 'anime' ? 'anime-guide' : 'tryon-tips'
  uni.navigateTo({
    url: `/pages/knowledge/index?category=${category}`,
  })
}

const garments = ref<Garment[]>([])
const page = ref(1)
const pageSize = 20
const total = ref(2727)
const hasMore = ref(true)
const loading = ref(false)
const refreshing = ref(false)

let debounceTimer: any = null
let requestVersion = 0

async function loadData(reset = false) {
  if (reset) {
    page.value = 1
    hasMore.value = true
  }
  if (loading.value || (!hasMore.value && !reset))
    return

  loading.value = true
  const currentVersion = ++requestVersion

  try {
    const res = await getGarments({
      library: library.value,
      category: activeCategory.value,
      q: searchKeyword.value,
      page: page.value,
      page_size: pageSize,
    })

    // 防竞态覆盖
    if (currentVersion !== requestVersion)
      return

    if (reset) {
      garments.value = res.list
    }
    else {
      // 去重追加
      const existingIds = new Set(garments.value.map(item => item.id))
      const newItems = res.list.filter(item => !existingIds.has(item.id))
      garments.value = [...garments.value, ...newItems]
    }

    total.value = res.total
    hasMore.value = res.has_more
    if (res.has_more) {
      page.value += 1
    }
  }
  finally {
    loading.value = false
    refreshing.value = false
    uni.stopPullDownRefresh()
  }
}

function handleSearchInput(e: any) {
  const val = e.detail?.value || ''
  searchKeyword.value = val
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    loadData(true)
  }, 300)
}

function handleSelectCategory(cat: GarmentCategory | 'all') {
  if (activeCategory.value === cat)
    return
  activeCategory.value = cat
  loadData(true)
}

function handleToggleLibrary(lib: LibraryType) {
  if (library.value === lib)
    return
  library.value = lib
  loadData(true)
}

onPullDownRefresh(() => {
  refreshing.value = true
  loadData(true)
})

onReachBottom(() => {
  if (hasMore.value && !loading.value) {
    loadData(false)
  }
})

onShow(() => {
  let needReload = false
  // 检查是否有优先图库偏好
  const pref = uni.getStorageSync('nvzhuang:gallery:preferred_lib')
  if (pref && (pref === 'real' || pref === 'anime') && pref !== library.value) {
    library.value = pref
    uni.removeStorageSync('nvzhuang:gallery:preferred_lib')
    needReload = true
  }
  // 检查是否有预设搜索词
  const prefQ = uni.getStorageSync('nvzhuang:gallery:preferred_q')
  if (prefQ !== undefined && prefQ !== null && prefQ !== '') {
    searchKeyword.value = prefQ
    uni.removeStorageSync('nvzhuang:gallery:preferred_q')
    needReload = true
  }
  if (needReload) {
    loadData(true)
  }
})

onMounted(async () => {
  const cats = await getCategories()
  if (cats && cats.length)
    categoriesList.value = cats
  loadData(true)
})
</script>

<template>
  <view class="gallery-page">
    <view class="status-bar-placeholder pt-safe" />

    <view class="screen-scroller">
      <!-- 页面标准大标题 -->
      <view class="std-head">
        <view class="head-titles">
          <text class="eyebrow">拍片哥女装 · PAIPIANGE</text>
          <view class="main-title">
            探索衣橱
          </view>
          <text class="sub-title">找到属于你的下一套心动穿搭</text>
        </view>
        <!-- 图库切换药丸 -->
        <view class="lib-switch">
          <view
            class="lib-tab"
            :class="{ active: library === 'real' }"
            @tap="handleToggleLibrary('real')"
          >
            写实
          </view>
          <view
            class="lib-tab"
            :class="{ active: library === 'anime' }"
            @tap="handleToggleLibrary('anime')"
          >
            二次元
          </view>
        </view>
      </view>

      <!-- 搜索框 -->
      <view class="searchbar">
        <view class="i-carbon-search text-15px text-#9d9394" />
        <input
          type="text"
          :value="searchKeyword"
          placeholder="搜索款式、颜色、关键词"
          placeholder-class="search-ph"
          class="search-input"
          @input="handleSearchInput"
        >
        <view
          v-if="searchKeyword"
          class="i-carbon-close ml-auto text-14px text-#999"
          @tap="searchKeyword = ''; loadData(true)"
        />
      </view>

      <!-- 分类 Chips -->
      <CategoryChips
        :categories="categoriesList"
        :active-category="activeCategory"
        @select="handleSelectCategory"
      />

      <!-- 二次元模式下的专属风格快捷过滤 -->
      <view v-if="library === 'anime'" class="anime-filter-row">
        <scroll-view scroll-x class="anime-chips-scroll" :show-scrollbar="false">
          <view class="anime-chips-wrap">
            <view
              v-for="st in animeStyles"
              :key="st.keyword"
              class="anime-quick-pill"
              :class="{ active: searchKeyword === st.keyword }"
              @tap="handleSelectAnimeStyle(st.keyword)"
            >
              {{ st.name }}
            </view>
          </view>
        </scroll-view>
      </view>

      <!-- 图库数量与排序指示 -->
      <view class="library-stats">
        <view class="stats-count">
          <text class="stats-bold">{{ total }}</text> 套灵感服饰
        </view>
        <view class="stats-right-group">
          <view class="kb-tip-btn" @tap="handleGoKnowledge">
            <text class="kb-tip-icon">📖</text>
            <text class="kb-tip-text">穿搭指南</text>
          </view>
          <view class="stats-sort">
            {{ library === 'real' ? '写实专区' : '二次元专区' }} · 精选 ▾
          </view>
        </view>
      </view>

      <!-- 卡片瀑布/两列网格 -->
      <view v-if="garments.length > 0" class="looks-grid">
        <GarmentCard
          v-for="item in garments"
          :key="item.id"
          :garment="item"
          :tall="true"
        />
      </view>

      <!-- 空态展示 -->
      <EmptyState
        v-else-if="!loading"
        title="没有找到相关服装"
        description="尝试换个关键词，或切换图库分类看看吧"
        action-text="清空搜索"
        @action="searchKeyword = ''; activeCategory = 'all'; loadData(true)"
      />

      <!-- 加载提示 -->
      <view v-if="loading" class="py-6 text-center text-11px text-#bba">
        <text>正在精心挑选灵感服饰...</text>
      </view>

      <view v-else-if="!hasMore && garments.length > 0" class="py-6 text-center text-10px text-#c8b8bb">
        <text>✦ 已经看完全部灵感了 ✦</text>
      </view>

      <!-- 留白 -->
      <view class="h-24" />
    </view>

    <!-- 底部 Tabbar -->
    <fg-tabbar />
  </view>
</template>

<style scoped lang="scss">
.gallery-page {
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

.lib-switch {
  display: flex;
  background: #f4f1f0;
  border-radius: 40rpx;
  padding: 6rpx;
}

.lib-tab {
  font-size: 20rpx;
  font-weight: 700;
  padding: 10rpx 22rpx;
  border-radius: 36rpx;
  color: #8b7d81;
  transition: all 0.2s ease;

  &.active {
    background: #ffffff;
    color: #cd7188;
    box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.08);
  }
}

.searchbar {
  margin: 0 0 26rpx;
  height: 80rpx;
  border-radius: 22rpx;
  background: #f4f1f0;
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 0 24rpx;
}

.search-input {
  background: transparent;
  border: 0;
  outline: 0;
  flex: 1;
  font-size: 22rpx;
  color: #292628;
}

.anime-filter-row {
  margin-top: 14rpx;
  margin-bottom: 8rpx;
}

.anime-chips-scroll {
  white-space: nowrap;
}

.anime-chips-wrap {
  display: inline-flex;
  gap: 12rpx;
  padding: 4rpx 0;
}

.anime-quick-pill {
  padding: 8rpx 20rpx;
  border-radius: 100rpx;
  font-size: 20rpx;
  background: #f1e9fa;
  color: #7e22ce;
  font-weight: 600;
  border: 1px solid rgba(147, 51, 234, 0.15);
  transition: all 0.2s ease;

  &.active {
    background: #9333ea;
    color: #ffffff;
    box-shadow: 0 4rpx 12rpx rgba(147, 51, 234, 0.3);
  }
}

.library-stats {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24rpx;
  font-size: 20rpx;
  color: #998f91;
}

.stats-right-group {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.kb-tip-btn {
  display: flex;
  align-items: center;
  gap: 6rpx;
  background: rgba(205, 101, 123, 0.1);
  color: #cd657b;
  padding: 6rpx 14rpx;
  border-radius: 100rpx;
  font-size: 20rpx;
  font-weight: 600;
}

.kb-tip-icon {
  font-size: 20rpx;
}

.stats-bold {
  color: #363037;
  font-size: 26rpx;
  font-weight: 800;
}

.looks-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32rpx 20rpx;
}
</style>
