<script lang="ts" setup>
import { ref } from 'vue'
import { useSettingsStore } from '@/store/settings'
import { useTryonStore } from '@/store/tryon'

definePage({
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '服务与模型设置',
  },
})

const settingsStore = useSettingsStore()
const tryonStore = useTryonStore()

const serverUrl = ref(settingsStore.serverBaseUrl)
const useMock = ref(settingsStore.useMock)
const expertMode = ref(settingsStore.expertMode)
const provider = ref(settingsStore.clientConfig.provider || 'gemini')
const apiKey = ref(settingsStore.clientConfig.apiKey || '')
const baseUrl = ref(settingsStore.clientConfig.baseUrl || '')
const model = ref(settingsStore.clientConfig.model || '')

const showKey = ref(false)
const testLoading = ref(false)

const providerOptions = [
  { label: 'Google Gemini', value: 'gemini' },
  { label: '火山引擎豆包', value: 'doubao' },
  { label: 'OpenAI 兼容', value: 'openai' },
]

function handleBack() {
  uni.navigateBack({
    fail: () => {
      uni.switchTab({ url: '/pages/mine/index' })
    },
  })
}

function handleSave() {
  settingsStore.serverBaseUrl = serverUrl.value.trim()
  settingsStore.useMock = useMock.value
  settingsStore.expertMode = expertMode.value
  settingsStore.clientConfig = {
    provider: provider.value as any,
    apiKey: apiKey.value.trim(),
    baseUrl: baseUrl.value.trim(),
    model: model.value.trim(),
  }
  settingsStore.saveSettings()
  uni.showToast({
    title: '设置已保存',
    icon: 'success',
  })
}

async function handleTestConnection() {
  testLoading.value = true
  const target = serverUrl.value.trim().replace(/\/+$/, '')
  try {
    const res = await uni.request({
      url: `${target}/api/v1/options`,
      method: 'GET',
      timeout: 5000,
    })
    if (res.statusCode >= 200 && res.statusCode < 300) {
      uni.showToast({
        title: '连接成功',
        icon: 'success',
      })
    }
    else {
      uni.showToast({
        title: `状态码: ${res.statusCode}`,
        icon: 'none',
      })
    }
  }
  catch (e: any) {
    uni.showToast({
      title: '连接失败，请检查网络或后端状态',
      icon: 'none',
    })
  }
  finally {
    testLoading.value = false
  }
}

function handleClearCache() {
  uni.showModal({
    title: '清理缓存',
    content: '确定清空所有本地试穿历史和缓存数据吗？',
    success: (res) => {
      if (res.confirm) {
        tryonStore.clearHistory()
        tryonStore.clearDraft()
        uni.showToast({
          title: '缓存已清除',
          icon: 'success',
        })
      }
    },
  })
}

function handleResetDefaults() {
  uni.showModal({
    title: '恢复默认',
    content: '确定恢复所有设置项为出厂默认值吗？',
    success: (res) => {
      if (res.confirm) {
        settingsStore.resetSettings()
        serverUrl.value = settingsStore.serverBaseUrl
        useMock.value = settingsStore.useMock
        expertMode.value = settingsStore.expertMode
        provider.value = settingsStore.clientConfig.provider
        apiKey.value = settingsStore.clientConfig.apiKey
        baseUrl.value = settingsStore.clientConfig.baseUrl
        model.value = settingsStore.clientConfig.model
        uni.showToast({
          title: '已恢复默认',
          icon: 'success',
        })
      }
    },
  })
}
</script>

<template>
  <view class="settings-page">
    <view class="status-bar-placeholder pt-safe" />

    <!-- 自定义导航栏 -->
    <view class="nav-bar">
      <view class="back-btn" @tap="handleBack">
        <view class="i-carbon-chevron-left text-20px text-#272225" />
      </view>
      <text class="nav-title">服务与模型设置</text>
      <view class="save-top-btn" @tap="handleSave">
        保存
      </view>
    </view>

    <scroll-view scroll-y class="settings-scroller">
      <view class="settings-content">
        <!-- 基础后端服务设置 -->
        <view class="card-section">
          <view class="section-header">
            <view class="i-carbon-server-dns text-18px text-#cd7188" />
            <text class="section-title">GoFrame 后端服务</text>
          </view>
          <text class="section-desc">
            移动端试穿请求将通过该后端服务统一转发调度。
          </text>

          <view class="input-group">
            <text class="input-label">服务基础地址 (Base URL)</text>
            <input
              v-model="serverUrl"
              class="text-input"
              type="text"
              placeholder="http://127.0.0.1:8000"
            >
          </view>

          <view class="action-row">
            <view class="preset-tag" @tap="serverUrl = 'http://127.0.0.1:8000'">
              本机 127.0.0.1:8000
            </view>
            <view class="preset-tag" @tap="serverUrl = 'http://10.0.2.2:8000'">
              Android模拟器 10.0.2.2
            </view>
            <view class="btn-test" :class="{ disabled: testLoading }" @tap="handleTestConnection">
              {{ testLoading ? '测试中...' : '测试连接' }}
            </view>
          </view>
        </view>

        <!-- 演示与调试选项 -->
        <view class="card-section">
          <view class="section-header">
            <view class="i-carbon-debug text-18px text-#cd7188" />
            <text class="section-title">本地运行模式</text>
          </view>

          <view class="switch-row">
            <view class="switch-info">
              <text class="switch-title">本地离线模拟模式 (Mock)</text>
              <text class="switch-sub">开启后不依赖后端服务，生成模拟试穿预览</text>
            </view>
            <switch
              :checked="useMock"
              color="#cd7188"
              @change="(e: any) => useMock = e.detail.value"
            />
          </view>
        </view>

        <!-- 自定义模型直调（专家模式） -->
        <view class="card-section">
          <view class="section-header">
            <view class="i-carbon-ai-status text-18px text-#cd7188" />
            <text class="section-title">客户端模型直调 (专家模式)</text>
          </view>
          <text class="section-desc">
            仅保存在您的本机，用于直接调用第三方多模态大模型 API。
          </text>

          <view class="switch-row">
            <view class="switch-info">
              <text class="switch-title">启用客户端直调</text>
              <text class="switch-sub">覆盖后端默认服务密钥，使用您自己的 Key</text>
            </view>
            <switch
              :checked="expertMode"
              color="#cd7188"
              @change="(e: any) => expertMode = e.detail.value"
            />
          </view>

          <view v-if="expertMode" class="expert-form">
            <view class="input-group">
              <text class="input-label">模型厂商</text>
              <view class="provider-selector">
                <view
                  v-for="item in providerOptions"
                  :key="item.value"
                  class="provider-chip"
                  :class="{ active: provider === item.value }"
                  @tap="provider = item.value as any"
                >
                  {{ item.label }}
                </view>
              </view>
            </view>

            <view class="input-group">
              <text class="input-label">API Key</text>
              <view class="input-with-eye">
                <input
                  v-model="apiKey"
                  class="text-input"
                  :password="!showKey"
                  placeholder="在此输入您的 API Key"
                >
                <view class="eye-btn" @tap="showKey = !showKey">
                  <view :class="showKey ? 'i-carbon-view-off' : 'i-carbon-view'" class="text-16px text-#888" />
                </view>
              </view>
            </view>

            <view class="input-group">
              <text class="input-label">自定义端点 (Base URL，选填)</text>
              <input
                v-model="baseUrl"
                class="text-input"
                type="text"
                placeholder="留空则使用厂商官方端点"
              >
            </view>

            <view class="input-group">
              <text class="input-label">自定义模型名称 (选填)</text>
              <input
                v-model="model"
                class="text-input"
                type="text"
                placeholder="例如: gemini-2.5-flash / doubao-pro"
              >
            </view>
          </view>
        </view>

        <!-- 数据与缓存 -->
        <view class="card-section">
          <view class="section-header">
            <view class="i-carbon-clean text-18px text-#cd7188" />
            <text class="section-title">存储与缓存管理</text>
          </view>

          <view class="danger-actions">
            <view class="btn-outline-danger" @tap="handleClearCache">
              清空本地试穿历史与草稿
            </view>
            <view class="btn-outline-secondary" @tap="handleResetDefaults">
              恢复默认网络设置
            </view>
          </view>
        </view>

        <!-- 隐私与安全声明 -->
        <view class="privacy-box">
          <view class="privacy-title">
            <view class="i-carbon-security mr-6rpx text-14px text-#7d6e73" />
            <text>安全与隐私保护声明</text>
          </view>
          <text class="privacy-text">
            根据零泄漏原则，您的 API Key、生成记录与自定义试穿照片完全留存在手机或浏览器本地存储中，不会持久化至服务端日志或第三方服务器。
          </text>
        </view>

        <!-- 底部大保存按钮 -->
        <view class="save-bottom-wrap">
          <button class="save-bottom-btn" @tap="handleSave">
            保存全部设置
          </button>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<style lang="scss" scoped>
.settings-page {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background-color: #fcfbfa;
}

.status-bar-placeholder {
  width: 100%;
}

.nav-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 90rpx;
  padding: 0 32rpx;
  background: #ffffff;
  border-bottom: 1px solid #f2e9eb;
}

.back-btn {
  width: 64rpx;
  height: 64rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #f7f3f4;
}

.nav-title {
  font-size: 30rpx;
  font-weight: 700;
  color: #272225;
}

.save-top-btn {
  font-size: 26rpx;
  font-weight: 600;
  color: #cd7188;
  padding: 10rpx 16rpx;
}

.settings-scroller {
  flex: 1;
  height: calc(100vh - 180rpx);
}

.settings-content {
  padding: 24rpx 32rpx 80rpx;
  display: flex;
  flex-direction: column;
  gap: 28rpx;
}

.card-section {
  background: #ffffff;
  border-radius: 24rpx;
  padding: 28rpx;
  box-shadow: 0 2rpx 12rpx rgba(39, 34, 37, 0.03);
  border: 1px solid #f6eff1;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 8rpx;
}

.section-title {
  font-size: 28rpx;
  font-weight: 700;
  color: #272225;
}

.section-desc {
  font-size: 22rpx;
  color: #8c8286;
  margin-bottom: 20rpx;
  display: block;
}

.input-group {
  margin-top: 20rpx;
}

.input-label {
  font-size: 22rpx;
  color: #5d5358;
  font-weight: 600;
  margin-bottom: 10rpx;
  display: block;
}

.text-input {
  width: 100%;
  height: 76rpx;
  background: #faf7f8;
  border: 1px solid #ebdcdf;
  border-radius: 14rpx;
  padding: 0 20rpx;
  font-size: 24rpx;
  color: #272225;
  box-sizing: border-box;
}

.input-with-eye {
  position: relative;
  display: flex;
  align-items: center;
}

.input-with-eye .text-input {
  padding-right: 70rpx;
}

.eye-btn {
  position: absolute;
  right: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 0 10rpx;
}

.action-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 18rpx;
}

.preset-tag {
  font-size: 20rpx;
  color: #7d6e73;
  background: #f4ecee;
  padding: 8rpx 16rpx;
  border-radius: 20rpx;
}

.btn-test {
  margin-left: auto;
  font-size: 22rpx;
  font-weight: 600;
  color: #ffffff;
  background: #cd7188;
  padding: 10rpx 24rpx;
  border-radius: 20rpx;
}

.btn-test.disabled {
  opacity: 0.6;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14rpx 0;
}

.switch-info {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  max-width: 75%;
}

.switch-title {
  font-size: 26rpx;
  font-weight: 600;
  color: #272225;
}

.switch-sub {
  font-size: 20rpx;
  color: #9c9195;
}

.expert-form {
  margin-top: 16rpx;
  border-top: 1px solid #f8f1f3;
  padding-top: 16rpx;
}

.provider-selector {
  display: flex;
  gap: 12rpx;
}

.provider-chip {
  flex: 1;
  text-align: center;
  font-size: 22rpx;
  padding: 14rpx 0;
  border-radius: 12rpx;
  background: #faf7f8;
  border: 1px solid #ebdcdf;
  color: #5d5358;
}

.provider-chip.active {
  background: #cd7188;
  border-color: #cd7188;
  color: #ffffff;
  font-weight: 600;
}

.danger-actions {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  margin-top: 16rpx;
}

.btn-outline-danger {
  width: 100%;
  text-align: center;
  font-size: 24rpx;
  font-weight: 600;
  color: #c94f65;
  background: #fdf2f4;
  border: 1px solid #f6c8d0;
  border-radius: 16rpx;
  padding: 18rpx 0;
}

.btn-outline-secondary {
  width: 100%;
  text-align: center;
  font-size: 24rpx;
  color: #7d6e73;
  background: #f7f3f4;
  border: 1px solid #e5dadc;
  border-radius: 16rpx;
  padding: 18rpx 0;
}

.privacy-box {
  background: #f9f4f5;
  border-radius: 20rpx;
  padding: 24rpx;
  border: 1px dashed #e2ced3;
}

.privacy-title {
  display: flex;
  align-items: center;
  font-size: 22rpx;
  font-weight: 700;
  color: #5d5358;
  margin-bottom: 8rpx;
}

.privacy-text {
  font-size: 20rpx;
  line-height: 1.5;
  color: #8c8286;
}

.save-bottom-wrap {
  margin-top: 12rpx;
}

.save-bottom-btn {
  width: 100%;
  height: 88rpx;
  line-height: 88rpx;
  background: linear-gradient(135deg, #cd7188 0%, #b85c74 100%);
  color: #ffffff;
  font-size: 28rpx;
  font-weight: 700;
  border-radius: 44rpx;
  border: none;
  box-shadow: 0 8rpx 20rpx rgba(205, 113, 136, 0.28);
}
</style>
