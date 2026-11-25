import type { CharacterProfile } from './character-state.mjs'
import { useSettingsStore } from '@/store/settings'
import { useTokenStore } from '@/store/token'
import { FACES, OUTFITS } from './catalog'

export interface GeneratedPortrait {
  imageUrl: string
  mime: string
  model: string
}

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp']

export function resolvePortraitEndpoint(base: string, pageOrigin: string) {
  const url = new URL(base.trim() || pageOrigin)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.search || url.hash
    || !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))
    || !(url.origin === pageOrigin || loopback)) {
    throw new Error('写真服务只允许同源 HTTPS 或本机回环地址，请检查服务设置。')
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/tryon`
  return url.href
}

const MAX_REFERENCE_BYTES = 8 * 1024 * 1024
const MAX_RESULT_IMAGE_CHARS = 24 * 1024 * 1024

async function boundedBlob(response: Response, maxBytes: number, mime?: string) {
  if (Number(response.headers.get('Content-Length')) > maxBytes) {
    await response.body?.cancel()
    throw new Error('图像数据过大，已停止读取。')
  }
  if (!response.body)
    throw new Error('当前浏览器无法读取图像响应。')
  const reader = response.body.getReader()
  const parts: ArrayBuffer[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done)
        return new Blob(parts, { type: mime })
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw new Error('图像数据过大，已停止读取。')
      }
      parts.push(value.slice().buffer)
    }
  }
  finally {
    reader.releaseLock()
  }
}

async function loadReference(url: string, signal: AbortSignal) {
  // Only immutable project gallery URLs enter here; never include credentials or follow a redirect.
  const response = await fetch(url, { signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' })
  if (!response.ok)
    throw new Error('图库图片暂不可用，请检查网络后手动重试。')
  const mime = response.headers.get('Content-Type')?.split(';')[0] || ''
  if (!IMAGE_MIMES.includes(mime))
    throw new Error('图库图片格式不符合要求。')
  const blob = await boundedBlob(response, MAX_REFERENCE_BYTES, mime)
  if (!blob.size)
    throw new Error('图库图片内容为空。')
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    const abort = () => reader.abort()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reader.onabort = () => reject(new Error('未能读取图库图片。'))
    reader.onloadend = () => signal.removeEventListener('abort', abort)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) {
      signal.removeEventListener('abort', abort)
      reject(new Error('写真任务已取消。'))
      return
    }
    reader.readAsDataURL(blob)
  })
}

export async function requestPortrait(profile: Readonly<CharacterProfile>, signal: AbortSignal, costAcknowledged = false): Promise<GeneratedPortrait> {
  let available = false
  // #ifdef H5
  available = typeof window !== 'undefined' && typeof fetch === 'function'
  // #endif
  if (!available)
    throw new Error('当前平台暂不支持高清写真，请在浏览器中打开。')
  const settings = useSettingsStore()
  const { provider, apiKey, baseUrl, model } = settings.clientConfig
  const clientConfig = apiKey || baseUrl || model
    ? { provider, api_key: apiKey, base_url: baseUrl, model }
    : undefined
  if (clientConfig && (!apiKey || !baseUrl || !model || !['gemini', 'openai', 'doubao'].includes(provider)))
    throw new Error('请在设置中填写完整的图像模型配置。')
  const face = FACES.find(item => item.id === profile.faceId)
  const outfit = OUTFITS.find(item => item.id === profile.outfitId && item.library === profile.outfitLibrary)
  if (!face || !outfit)
    throw new Error('当前头像或穿搭已不在图库中。')
  if (settings.useMock)
    throw new Error('当前开启模拟数据，请在设置中关闭后再生成写真。')

  const endpoint = resolvePortraitEndpoint(settings.serverBaseUrl, window.location.origin)
  const token = useTokenStore().updateNowTime().validToken
  const [person, garment] = await Promise.all([loadReference(face.src, signal), loadReference(outfit.referenceSrc, signal)])
  // The shared http wrapper has no abort handle and can replay requests after auth refresh.
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    credentials: 'same-origin',
    redirect: 'error',
    cache: 'no-store',
    signal,
    body: JSON.stringify({
      person_image: person,
      garment_image: garment,
      pose_id: profile.poseId,
      keep_face: true,
      size: '1024x1536',
      client_config: clientConfig,
      cost_acknowledged: costAcknowledged,
    }),
  })
  if (!response.ok)
    throw new Error('写真生成失败，请检查图像服务设置后手动重试。')
  const body = await (await boundedBlob(response, MAX_RESULT_IMAGE_CHARS + 64 * 1024)).text()
  let result: { code?: number, data?: { image?: unknown, mime?: unknown, model?: unknown } } | null
  try {
    result = JSON.parse(body)
  }
  catch {
    throw new Error('图像服务响应格式无效，请检查模型设置后手动重试。')
  }
  const data = result?.data
  if (result?.code !== 0 || typeof data?.image !== 'string' || !data.image.length || data.image.length > MAX_RESULT_IMAGE_CHARS
    || data.image.length % 4 !== 0 || !/^[A-Z0-9+/]+={0,2}$/i.test(data.image)
    || typeof data.mime !== 'string' || !IMAGE_MIMES.includes(data.mime) || typeof data.model !== 'string') {
    throw new Error('图像服务未返回有效写真，请检查模型设置后手动重试。')
  }
  return { imageUrl: `data:${data.mime};base64,${data.image}`, mime: data.mime, model: data.model }
}
