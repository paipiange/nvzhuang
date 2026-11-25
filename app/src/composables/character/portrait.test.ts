import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, expect, it, vi } from 'vitest'
import { CHARACTERS } from './catalog'
import { requestPortrait, resolvePortraitEndpoint } from './portrait'

vi.mock('@/store/settings', () => ({
  useSettingsStore: () => ({
    serverBaseUrl: 'http://127.0.0.1:8000',
    clientConfig: { provider: 'gemini', apiKey: 'test-key', baseUrl: 'https://images.invalid/v1', model: 'test-image' },
  }),
}))
vi.mock('@/store/token', () => ({ useTokenStore: () => ({ updateNowTime: () => ({ validToken: '' }) }) }))

afterEach(() => vi.unstubAllGlobals())

it('uses only same-origin HTTPS or a loopback portrait proxy', () => {
  const origin = 'https://companion.invalid'
  expect(resolvePortraitEndpoint('', origin)).toBe(`${origin}/tryon`)
  expect(resolvePortraitEndpoint('https://companion.invalid/proxy/', origin)).toBe(`${origin}/proxy/tryon`)
  expect(resolvePortraitEndpoint('http://localhost:8000', origin)).toBe('http://localhost:8000/tryon')
  for (const address of ['https://external.invalid', 'http://companion.invalid', 'http://127.0.0.1:8000/?target=external', 'https://user:pass@localhost'])
    expect(() => resolvePortraitEndpoint(address, origin)).toThrow()
})

it('loads only public project gallery images and sends the fixed pose and existing image config once to the proxy', async () => {
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('FileReader', class {
    result = 'data:image/webp;base64,AA=='
    onload?: () => void
    onloadend?: () => void
    readAsDataURL() {
      this.onload?.()
      this.onloadend?.()
    }
  })
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST'
    ? Response.json({ code: 0, data: { image: 'AAAA', mime: 'image/png', model: 'configured' } })
    : new Response('mock', { headers: { 'Content-Type': 'image/webp' } }))
  vi.stubGlobal('fetch', fetchMock)
  const controller = new AbortController()
  const result = await requestPortrait({ ...CHARACTERS[0], poseId: 'wave' }, controller.signal)
  expect(result).toEqual({ imageUrl: 'data:image/png;base64,AAAA', mime: 'image/png', model: 'configured' })
  expect(fetchMock.mock.calls.slice(0, 2).every(([url, init]) => url.startsWith('https://paipiange.github.io/nvzhuang/assets/')
    && init?.credentials === 'omit' && init.redirect === 'error' && init.signal === controller.signal && !init.body)).toBe(true)
  expect(fetchMock.mock.calls).toHaveLength(3)
  const [url, init] = fetchMock.mock.calls[2]
  expect(url).toBe('http://127.0.0.1:8000/tryon')
  expect(init).toMatchObject({ method: 'POST', redirect: 'error', signal: controller.signal })
  expect(JSON.parse(init?.body as string)).toMatchObject({ pose_id: 'wave', person_image: 'data:image/webp;base64,AA==', garment_image: 'data:image/webp;base64,AA==', client_config: { api_key: 'test-key', base_url: 'https://images.invalid/v1' } })
})

it('cancels an oversized gallery stream with no Content-Length before a paid request', async () => {
  const cancel = vi.fn()
  const fetchMock = vi.fn(async () => new Response(new ReadableStream({
    start(stream) {
      stream.enqueue(new Uint8Array(8 * 1024 * 1024 + 1))
    },
    cancel,
  }), { headers: { 'Content-Type': 'image/webp' } }))
  vi.stubGlobal('fetch', fetchMock)
  await expect(requestPortrait(CHARACTERS[0], new AbortController().signal)).rejects.toThrow('图像数据过大')
  expect(cancel).toHaveBeenCalled()
  expect(fetchMock).toHaveBeenCalledTimes(2)
})
