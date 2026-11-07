import type { CategoryItem } from '@/types/garment'
import { CATEGORIES } from '@/mock/data'
import { http } from '@/http/http'
import { useSettingsStore } from '@/store/settings'

export async function getCategories(): Promise<CategoryItem[]> {
  const settings = useSettingsStore()
  if (settings.useMock) {
    return CATEGORIES
  }
  try {
    const res = await http<CategoryItem[]>({
      url: '/api/v1/catalog/categories',
      method: 'GET',
    })
    return res || CATEGORIES
  }
  catch (e) {
    console.warn('API /catalog/categories failed, falling back to local categories', e)
    return CATEGORIES
  }
}
