import type { Garment, GarmentQuery, PageResult } from '@/types/garment'
import { MOCK_GARMENTS } from '@/mock/data'
import { http } from '@/http/http'
import { useSettingsStore } from '@/store/settings'

export async function getGarments(params: GarmentQuery): Promise<PageResult<Garment>> {
  const settings = useSettingsStore()

  if (settings.useMock) {
    return filterMockGarments(params)
  }

  try {
    const res = await http<PageResult<Garment>>({
      url: '/api/v1/garments',
      method: 'GET',
      query: {
        library: params.library,
        category: params.category === 'all' ? undefined : params.category,
        q: params.q,
        page: params.page,
        page_size: params.page_size,
      },
    })
    if (res && Array.isArray(res.list)) {
      return res
    }
    return filterMockGarments(params)
  }
  catch (e) {
    console.warn('API /garments failed, falling back to mock dataset', e)
    return filterMockGarments(params)
  }
}

export async function getGarmentById(id: string): Promise<Garment | null> {
  const settings = useSettingsStore()
  if (settings.useMock) {
    const found = MOCK_GARMENTS.find(g => g.id === id)
    return found || null
  }

  try {
    const res = await http<Garment>({
      url: `/api/v1/garments/${encodeURIComponent(id)}`,
      method: 'GET',
    })
    return res || MOCK_GARMENTS.find(g => g.id === id) || null
  }
  catch (e) {
    return MOCK_GARMENTS.find(g => g.id === id) || null
  }
}

function filterMockGarments(params: GarmentQuery): PageResult<Garment> {
  let list = MOCK_GARMENTS.filter(item => item.library === params.library)

  if (params.category && params.category !== 'all') {
    list = list.filter(item => item.category === params.category)
  }

  if (params.q && params.q.trim()) {
    const kw = params.q.trim().toLowerCase()
    list = list.filter(item =>
      item.title.toLowerCase().includes(kw)
      || item.original_id.toLowerCase().includes(kw)
      || item.keywords.some(k => k.toLowerCase().includes(kw)),
    )
  }

  const total = list.length
  const page = params.page || 1
  const pageSize = params.page_size || 20
  const start = (page - 1) * pageSize
  const pagedList = list.slice(start, start + pageSize)

  return {
    list: pagedList,
    page,
    page_size: pageSize,
    total,
    has_more: start + pageSize < total,
  }
}
