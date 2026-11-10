import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '@/http/http'
import { useSettingsStore } from '@/store/settings'
import { getGarmentById, getGarments } from './garment'

vi.mock('@/http/http', () => ({
  http: vi.fn(),
}))

describe('garment api', () => {
  const mockedHttp = vi.mocked(http)

  beforeEach(() => {
    mockedHttp.mockReset()
  })

  it('useMock 为 true 时直接返回本地示例数据且不触发 onFallback', async () => {
    const settings = useSettingsStore()
    settings.useMock = true
    const onFallback = vi.fn()

    const res = await getGarments(
      { library: 'real', page: 1, page_size: 4 },
      { hideErrorToast: true, onFallback },
    )

    expect(mockedHttp).not.toHaveBeenCalled()
    expect(onFallback).not.toHaveBeenCalled()
    expect(res.list.length).toBeGreaterThan(0)
    expect(res.list.every(item => item.library === 'real')).toBe(true)
  })

  it('后端请求正常返回 list 时返回真实响应且不触发 onFallback', async () => {
    const settings = useSettingsStore()
    settings.useMock = false
    const onFallback = vi.fn()

    const apiResponse = {
      list: [
        {
          id: 'real:TEST-01',
          original_id: 'TEST-01',
          library: 'real' as const,
          category: 'spring' as const,
          title: '测试裙装',
          keywords: ['spring'],
          thumbnail_url: 'https://example.com/t.webp',
          image_url: 'https://example.com/i.webp',
        },
      ],
      page: 1,
      page_size: 6,
      total: 1,
      has_more: false,
    }
    mockedHttp.mockResolvedValueOnce(apiResponse)

    const res = await getGarments(
      { library: 'real', page: 1, page_size: 6 },
      { hideErrorToast: true, onFallback },
    )

    expect(mockedHttp).toHaveBeenCalledWith(expect.objectContaining({
      url: '/api/v1/garments',
      method: 'GET',
      hideErrorToast: true,
    }))
    expect(onFallback).not.toHaveBeenCalled()
    expect(res).toEqual(apiResponse)
  })

  it('网络异常导致请求失败时触发 onFallback 并回退到本地示例数据', async () => {
    const settings = useSettingsStore()
    settings.useMock = false
    const onFallback = vi.fn()
    const networkErr = new Error('network timeout')
    mockedHttp.mockRejectedValueOnce(networkErr)

    const res = await getGarments(
      { library: 'anime', page: 1, page_size: 6 },
      { hideErrorToast: true, onFallback },
    )

    expect(onFallback).toHaveBeenCalledTimes(1)
    expect(onFallback).toHaveBeenCalledWith(networkErr)
    expect(res.list.length).toBeGreaterThan(0)
    expect(res.list.every(item => item.library === 'anime')).toBe(true)
  })

  it('响应结构异常（非 JSON 列表）时触发 onFallback 并回退到本地示例数据', async () => {
    const settings = useSettingsStore()
    settings.useMock = false
    const onFallback = vi.fn()
    mockedHttp.mockResolvedValueOnce('<html>ngrok warning</html>' as any)

    const res = await getGarments(
      { library: 'real', page: 1, page_size: 6 },
      { hideErrorToast: true, onFallback },
    )

    expect(onFallback).toHaveBeenCalledTimes(1)
    expect(res.list.length).toBeGreaterThan(0)
  })

  it('getGarmentById 在离线模式下可命中本地示例服装', async () => {
    const settings = useSettingsStore()
    settings.useMock = true

    const item = await getGarmentById('real:SPR-0001')

    expect(mockedHttp).not.toHaveBeenCalled()
    expect(item?.id).toBe('real:SPR-0001')
  })
})
