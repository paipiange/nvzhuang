import type { CustomRequestOptions } from '@/http/types'
import { useSettingsStore } from '@/store/settings'
import { useTokenStore } from '@/store'
import { getCurrentBaseUrl } from '@/utils'
import { stringifyQuery } from './tools/queryString'

// 拦截器配置
const httpInterceptor = {
  // 拦截前触发
  invoke(options: CustomRequestOptions) {
    // 如果您使用了alova，则请把下面的代码放开注释
    // alova 执行流程：alova beforeRequest --> 本拦截器 --> alova responded
    // return options

    // 非 alova 请求，正常执行
    // 接口请求支持通过 query 参数配置 queryString
    if (options.query) {
      const queryStr = stringifyQuery(options.query)
      if (options.url.includes('?')) {
        options.url += `&${queryStr}`
      }
      else {
        options.url += `?${queryStr}`
      }
    }
    // 非 http 开头需拼接地址
    if (!options.url.startsWith('http')) {
      // 动态获取当前配置的 base url（优先用户在设置中自定义保存的地址，未设置则使用环境默认地址）
      let activeBaseUrl = ''
      try {
        const settingsStore = useSettingsStore()
        activeBaseUrl = settingsStore.serverBaseUrl?.trim() || getCurrentBaseUrl()
      }
      catch {
        activeBaseUrl = getCurrentBaseUrl()
      }
      activeBaseUrl = activeBaseUrl.replace(/\/+$/, '')

      const cleanPath = options.url.startsWith('/') ? options.url : `/${options.url}`

      // #ifdef H5
      if (JSON.parse(import.meta.env.VITE_APP_PROXY_ENABLE)) {
        // 自动拼接代理前缀
        options.url = import.meta.env.VITE_APP_PROXY_PREFIX + cleanPath
      }
      else {
        options.url = activeBaseUrl + cleanPath
      }
      // #endif
      // 非H5正常拼接
      // #ifndef H5
      options.url = activeBaseUrl + cleanPath
      // #endif
      // TIPS: 如果需要对接多个后端服务，也可以在这里处理，拼接成所需要的地址
    }
    // 1. 请求超时
    options.timeout = 60000 // 60s
    // 2. （可选）添加小程序端请求头标识与 ngrok 穿透跳过警告头
    options.header = {
      'ngrok-skip-browser-warning': 'true',
      ...options.header,
    }
    // 3. 添加 token 请求头标识
    const tokenStore = useTokenStore()
    const token = tokenStore.updateNowTime().validToken

    if (token) {
      options.header.Authorization = `Bearer ${token}`
    }
    return options
  },
}

export const requestInterceptor = {
  install() {
    // 拦截 request 请求
    uni.addInterceptor('request', httpInterceptor)
    // 拦截 uploadFile 文件上传
    uni.addInterceptor('uploadFile', httpInterceptor)
  },
}
