<script lang="ts" setup>
import { computed, ref } from 'vue'
import { onLoad, onShareAppMessage } from '@dcloudio/uni-app'
import type { KnowledgeArticle, PromptItem } from '@/types/knowledge'
import { getKnowledgeArticleById, getKnowledgeArticles } from '@/data/knowledge'
import { showToast } from '@/utils/platform'

defineOptions({
  name: 'KnowledgeDetailPage',
})

definePage({
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '知识库详情',
  },
})

const articleId = ref('')
const article = ref<KnowledgeArticle | null>(null)

const relatedArticles = computed(() => {
  if (!article.value)
    return []
  return getKnowledgeArticles(article.value.category)
    .filter(a => a.id !== article.value?.id)
    .slice(0, 2)
})

function handleGoBack() {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack()
  }
  else {
    uni.redirectTo({
      url: '/pages/knowledge/index',
    })
  }
}

function handleCopyPrompt(prompt: PromptItem, lang: 'en' | 'zh' = 'en') {
  const text = lang === 'en' ? prompt.en : prompt.zh
  uni.setClipboardData({
    data: text,
    success: () => {
      showToast(`已复制${lang === 'en' ? '英文' : '中文'}提示词 ✦`, 'success')
    },
    fail: () => {
      showToast('复制失败，请重试')
    },
  })
}

function handleAction(action?: { type: string, payload?: string }) {
  if (!action)
    return
  if (action.type === 'gallery') {
    if (action.payload) {
      uni.setStorageSync('nvzhuang:gallery:preferred_lib', action.payload)
    }
    uni.switchTab({
      url: '/pages/gallery/index',
    })
  }
  else if (action.type === 'tryon') {
    uni.switchTab({
      url: '/pages/tryon/index',
    })
  }
  else if (action.type === 'models') {
    uni.navigateTo({
      url: '/pages/models/index',
    })
  }
  else if (action.type === 'external' && action.payload) {
    uni.navigateTo({
      url: action.payload,
    })
  }
}

function handleSelectRelated(item: KnowledgeArticle) {
  article.value = item
  articleId.value = item.id
  uni.pageScrollTo({
    scrollTop: 0,
    duration: 200,
  })
}

onShareAppMessage(() => {
  return {
    title: article.value ? `${article.value.title} · 拍片哥女装知识库` : '拍片哥女装 · 穿搭与生图知识库',
    path: `/pages/knowledge/detail?id=${encodeURIComponent(articleId.value)}`,
  }
})

onLoad((options: any) => {
  if (options && options.id) {
    articleId.value = decodeURIComponent(options.id)
    const found = getKnowledgeArticleById(articleId.value)
    if (found) {
      article.value = found
    }
  }
})
</script>

<template>
  <view class="article-detail-page">
    <view class="status-bar-placeholder pt-safe" />

    <view v-if="article" class="screen-scroller">
      <!-- 顶栏导航 -->
      <view class="top-bar">
        <view class="round-btn" @tap="handleGoBack">
          <view class="i-carbon-arrow-left text-17px text-#272225" />
        </view>
        <view class="center-brand">
          <text class="brand-micro">拍片哥女装 · 知识库</text>
          <text class="brand-cat">{{ article.categoryZh }}</text>
        </view>
        <button class="round-btn share-btn" open-type="share">
          <view class="i-carbon-share text-16px text-#272225" />
        </button>
      </view>

      <!-- 文章标题与元数据 -->
      <view class="article-header">
        <view class="cat-pill-row">
          <text class="cat-badge">{{ article.categoryZh }}</text>
          <text class="read-badge">{{ article.readTime }}阅读</text>
          <text class="date-badge">{{ article.updatedAt }}</text>
        </view>
        <view class="main-heading">
          {{ article.title }}
        </view>
        <text class="sub-heading">{{ article.subtitle }}</text>
      </view>

      <!-- 封面图 -->
      <view class="cover-box">
        <image :src="article.coverImage" mode="aspectFill" class="cover-img" />
      </view>

      <!-- 导言摘要 Callout -->
      <view class="summary-box">
        <view class="summary-head">
          <text class="summary-ico">💡</text>
          <text class="summary-label">核心速览</text>
        </view>
        <text class="summary-text">{{ article.summary }}</text>
      </view>

      <!-- 标签行 -->
      <view class="tag-row">
        <text v-for="tag in article.tags" :key="tag" class="tag-item"># {{ tag }}</text>
      </view>

      <!-- 正文章节 -->
      <view class="article-content">
        <view
          v-for="(sec, idx) in article.sections"
          :key="idx"
          class="content-section"
        >
          <view class="sec-heading">
            {{ sec.heading }}
          </view>

          <view class="sec-paragraphs">
            <text
              v-for="(p, pIdx) in sec.content"
              :key="pIdx"
              class="sec-p"
            >
              {{ p }}
            </text>
          </view>

          <!-- 突出高亮段落 -->
          <view v-if="sec.highlight" class="highlight-callout">
            <view class="callout-bar" />
            <text class="callout-text">✦ {{ sec.highlight }}</text>
          </view>

          <!-- 提示贴士 -->
          <view v-if="sec.tips && sec.tips.length" class="tips-box">
            <view class="tips-head">
              <text class="tips-ico">📌</text>
              <text class="tips-title">调参实操贴士</text>
            </view>
            <view class="tips-list">
              <text v-for="(tip, tIdx) in sec.tips" :key="tIdx" class="tip-line">
                • {{ tip }}
              </text>
            </view>
          </view>

          <!-- 提示词卡片列表 -->
          <view v-if="sec.prompts && sec.prompts.length" class="prompts-group">
            <view class="prompts-group-title">
              <view class="i-carbon-code text-14px text-#cd657b" />
              <text>精选调优提示词（轻触复制）</text>
            </view>

            <view
              v-for="(pm, pIdx) in sec.prompts"
              :key="pIdx"
              class="prompt-card"
            >
              <view class="prompt-header">
                <text class="prompt-name">{{ pm.label }}</text>
                <text v-if="pm.category" class="prompt-cat">{{ pm.category }}</text>
              </view>

              <view class="prompt-body-en">
                <text class="code-text">{{ pm.en }}</text>
              </view>

              <view class="prompt-body-zh">
                <text class="zh-text">含义：{{ pm.zh }}</text>
              </view>

              <view class="prompt-actions">
                <view class="action-copy-btn en-btn" @tap="handleCopyPrompt(pm, 'en')">
                  <view class="i-carbon-copy text-12px" />
                  <text>复制英文提示词</text>
                </view>
                <view class="action-copy-btn zh-btn" @tap="handleCopyPrompt(pm, 'zh')">
                  <view class="i-carbon-copy text-12px" />
                  <text>复制中文释义</text>
                </view>
              </view>
            </view>
          </view>

          <!-- 章节行动按钮 -->
          <view v-if="sec.action" class="section-action-box">
            <view class="action-btn-primary" @tap="handleAction(sec.action)">
              <text>{{ sec.action.text }}</text>
              <view class="i-carbon-arrow-right text-14px" />
            </view>
          </view>
        </view>
      </view>

      <!-- 相关文章推荐 -->
      <view v-if="relatedArticles.length > 0" class="related-section">
        <view class="related-title">
          <text class="sec-label">CONTINUE READING</text>
          <view class="sec-h3">
            延伸阅读 ✳
          </view>
        </view>
        <view class="related-list">
          <view
            v-for="rel in relatedArticles"
            :key="rel.id"
            class="rel-card"
            @tap="handleSelectRelated(rel)"
          >
            <image :src="rel.coverImage" mode="aspectFill" class="rel-thumb" />
            <view class="rel-body">
              <text class="rel-cat">{{ rel.categoryZh }}</text>
              <view class="rel-heading">
                {{ rel.title }}
              </view>
              <text class="rel-read">{{ rel.readTime }}阅读 ➔</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 底部版权与免责声明 -->
      <view class="article-footer">
        <text class="footer-brand">拍片哥女装 · AI 穿搭知识库</text>
        <text class="footer-desc">
          基于 2727 套纯服装图集与 1499 位 CC0 模特沉淀。提示词支持各类 WebUI、ComfyUI 及主流文生图大模型。
        </text>
      </view>

      <view class="h-16" />
    </view>

    <!-- 错误缺省页 -->
    <view v-else class="not-found-box">
      <view class="status-bar-placeholder pt-safe" />
      <view class="not-found-content">
        <text class="nf-ico">📂</text>
        <text class="nf-title">未找到相关文章</text>
        <view class="back-home-btn" @tap="handleGoBack">
          返回知识库首页
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.article-detail-page {
  min-height: 100vh;
  background-color: #fcfbfa;
  color: #272225;
}

.screen-scroller {
  padding: 0 32rpx 40rpx;
}

.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16rpx 0 24rpx;
}

.round-btn {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.04);
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  padding: 0;
  margin: 0;

  &::after {
    border: none;
  }
}

.share-btn {
  background: rgba(205, 101, 123, 0.1);
}

.center-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.brand-micro {
  font-size: 18rpx;
  color: #a89fa1;
  font-weight: 600;
  letter-spacing: 2rpx;
}

.brand-cat {
  font-size: 26rpx;
  font-weight: 700;
  color: #272225;
}

.article-header {
  margin-top: 10rpx;
  margin-bottom: 24rpx;
}

.cat-pill-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 16rpx;
}

.cat-badge {
  background: #cd657b;
  color: #ffffff;
  font-size: 20rpx;
  font-weight: 600;
  padding: 4rpx 14rpx;
  border-radius: 6rpx;
}

.read-badge,
.date-badge {
  font-size: 20rpx;
  color: #9d9394;
}

.main-heading {
  font-size: 40rpx;
  font-weight: 800;
  line-height: 1.35;
  color: #272225;
  margin-bottom: 12rpx;
}

.sub-heading {
  font-size: 26rpx;
  color: #72676a;
  line-height: 1.5;
  display: block;
}

.cover-box {
  width: 100%;
  height: 380rpx;
  border-radius: 24rpx;
  overflow: hidden;
  margin-bottom: 24rpx;
  box-shadow: 0 8rpx 24rpx rgba(0, 0, 0, 0.05);
}

.cover-img {
  width: 100%;
  height: 100%;
  background: #eae5e7;
}

.summary-box {
  background: #f5eff1;
  border-left: 6rpx solid #cd657b;
  padding: 24rpx 28rpx;
  border-radius: 12rpx;
  margin-bottom: 24rpx;
}

.summary-head {
  display: flex;
  align-items: center;
  gap: 10rpx;
  margin-bottom: 8rpx;
}

.summary-ico {
  font-size: 26rpx;
}

.summary-label {
  font-size: 24rpx;
  font-weight: 700;
  color: #8c3b4e;
}

.summary-text {
  font-size: 24rpx;
  color: #55494d;
  line-height: 1.6;
  display: block;
}

.tag-row {
  display: flex;
  gap: 12rpx;
  flex-wrap: wrap;
  margin-bottom: 32rpx;
}

.tag-item {
  background: #ece7e8;
  color: #63585b;
  font-size: 20rpx;
  padding: 6rpx 16rpx;
  border-radius: 100rpx;
}

.article-content {
  margin-bottom: 40rpx;
}

.content-section {
  margin-bottom: 36rpx;
}

.sec-heading {
  font-size: 32rpx;
  font-weight: 700;
  color: #272225;
  margin-bottom: 16rpx;
  line-height: 1.4;
  padding-left: 14rpx;
  border-left: 6rpx solid #cd657b;
}

.sec-paragraphs {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.sec-p {
  font-size: 26rpx;
  color: #3e3237;
  line-height: 1.7;
}

.highlight-callout {
  display: flex;
  background: #fff8f9;
  border: 1px solid rgba(205, 101, 123, 0.25);
  border-radius: 14rpx;
  padding: 20rpx 24rpx;
  margin: 20rpx 0;
}

.callout-text {
  font-size: 24rpx;
  font-weight: 600;
  color: #9f364d;
  line-height: 1.5;
}

.tips-box {
  background: #fdfaf2;
  border: 1px solid rgba(217, 119, 6, 0.2);
  border-radius: 16rpx;
  padding: 22rpx 24rpx;
  margin: 20rpx 0;
}

.tips-head {
  display: flex;
  align-items: center;
  gap: 8rpx;
  margin-bottom: 12rpx;
}

.tips-ico {
  font-size: 24rpx;
}

.tips-title {
  font-size: 24rpx;
  font-weight: 700;
  color: #b45309;
}

.tips-list {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.tip-line {
  font-size: 22rpx;
  color: #78350f;
  line-height: 1.5;
}

.prompts-group {
  margin: 24rpx 0;
}

.prompts-group-title {
  display: flex;
  align-items: center;
  gap: 10rpx;
  font-size: 24rpx;
  font-weight: 700;
  color: #cd657b;
  margin-bottom: 14rpx;
}

.prompt-card {
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 18rpx;
  padding: 24rpx;
  margin-bottom: 18rpx;
  box-shadow: 0 4rpx 14rpx rgba(0, 0, 0, 0.02);
}

.prompt-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12rpx;
}

.prompt-name {
  font-size: 26rpx;
  font-weight: 700;
  color: #272225;
}

.prompt-cat {
  font-size: 20rpx;
  color: #9d9394;
  background: #f2edee;
  padding: 2rpx 10rpx;
  border-radius: 6rpx;
}

.prompt-body-en {
  background: #272225;
  border-radius: 12rpx;
  padding: 18rpx;
  margin-bottom: 12rpx;
}

.code-text {
  font-family: monospace;
  font-size: 22rpx;
  color: #f7b4c4;
  line-height: 1.5;
  word-break: break-all;
}

.prompt-body-zh {
  margin-bottom: 16rpx;
}

.zh-text {
  font-size: 22rpx;
  color: #63585b;
  line-height: 1.45;
}

.prompt-actions {
  display: flex;
  gap: 16rpx;
}

.action-copy-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  padding: 14rpx 0;
  border-radius: 12rpx;
  font-size: 22rpx;
  font-weight: 600;

  &.en-btn {
    background: #cd657b;
    color: #ffffff;
  }

  &.zh-btn {
    background: #f2ecee;
    color: #63585b;
  }
}

.section-action-box {
  margin-top: 24rpx;
}

.action-btn-primary {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  background: linear-gradient(135deg, #cd657b 0%, #b34a61 100%);
  color: #ffffff;
  padding: 22rpx 32rpx;
  border-radius: 100rpx;
  font-size: 26rpx;
  font-weight: 700;
  box-shadow: 0 6rpx 20rpx rgba(205, 101, 123, 0.3);
}

.related-section {
  margin-top: 40rpx;
  padding-top: 30rpx;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.related-title {
  margin-bottom: 20rpx;
}

.sec-label {
  font-size: 20rpx;
  font-weight: 700;
  letter-spacing: 2rpx;
  color: #a89ea2;
}

.sec-h3 {
  font-size: 32rpx;
  font-weight: 700;
  color: #272225;
}

.related-list {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.rel-card {
  display: flex;
  background: #ffffff;
  border-radius: 18rpx;
  padding: 16rpx;
  gap: 16rpx;
  box-shadow: 0 4rpx 14rpx rgba(0, 0, 0, 0.02);
}

.rel-thumb {
  width: 140rpx;
  height: 160rpx;
  border-radius: 12rpx;
  background: #eae5e7;
  flex-shrink: 0;
}

.rel-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.rel-cat {
  font-size: 20rpx;
  color: #cd657b;
  font-weight: 600;
}

.rel-heading {
  font-size: 26rpx;
  font-weight: 700;
  color: #272225;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.rel-read {
  font-size: 20rpx;
  color: #9d9394;
}

.article-footer {
  margin-top: 48rpx;
  padding: 30rpx 24rpx;
  background: #f3eff0;
  border-radius: 18rpx;
  text-align: center;
}

.footer-brand {
  font-size: 24rpx;
  font-weight: 700;
  color: #55494d;
  display: block;
  margin-bottom: 8rpx;
}

.footer-desc {
  font-size: 20rpx;
  color: #8c8084;
  line-height: 1.5;
  display: block;
}

.not-found-box {
  padding: 120rpx 40rpx;
  text-align: center;
}

.not-found-content {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.nf-ico {
  font-size: 72rpx;
  margin-bottom: 20rpx;
}

.nf-title {
  font-size: 30rpx;
  font-weight: 600;
  color: #3e3237;
  margin-bottom: 30rpx;
}

.back-home-btn {
  background: #cd657b;
  color: #ffffff;
  padding: 18rpx 40rpx;
  border-radius: 100rpx;
  font-size: 26rpx;
  font-weight: 600;
}
</style>
