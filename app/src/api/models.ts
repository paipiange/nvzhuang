import type { ModelPortrait, PageResult } from '@/types/garment'
import type { ModelOption } from '@/types/tryon'
import { MOCK_PORTRAITS, MODEL_OPTIONS } from '@/mock/data'
import { http } from '@/http/http'
import { useSettingsStore } from '@/store/settings'

export async function getModelPortraits(params?: {
  hairstyle?: string
  page?: number
  page_size?: number
}): Promise<PageResult<ModelPortrait>> {
  const settings = useSettingsStore()
  if (settings.useMock) {
    let list = [...MOCK_PORTRAITS]
    if (params?.hairstyle && params.hairstyle !== '全部') {
      list = list.filter(item => item.hairstyle?.includes(params.hairstyle!) || item.category === params.hairstyle)
    }
    const page = params?.page || 1
    const pageSize = params?.page_size || 20
    const start = (page - 1) * pageSize
    return {
      list: list.slice(start, start + pageSize),
      page,
      page_size: pageSize,
      total: list.length,
      has_more: start + pageSize < list.length,
    }
  }

  try {
    const res = await http<PageResult<ModelPortrait>>({
      url: '/api/v1/models',
      method: 'GET',
      query: params,
    })
    return res || {
      list: MOCK_PORTRAITS,
      page: 1,
      page_size: 20,
      total: MOCK_PORTRAITS.length,
      has_more: false,
    }
  }
  catch (e) {
    return {
      list: MOCK_PORTRAITS,
      page: 1,
      page_size: 20,
      total: MOCK_PORTRAITS.length,
      has_more: false,
    }
  }
}

export async function getModelOptions(): Promise<ModelOption[]> {
  const settings = useSettingsStore()
  if (settings.useMock) {
    return MODEL_OPTIONS
  }
  try {
    const res = await http<ModelOption[]>({
      url: '/api/v1/tryon/options',
      method: 'GET',
    })
    return res || MODEL_OPTIONS
  }
  catch (e) {
    return MODEL_OPTIONS
  }
}
