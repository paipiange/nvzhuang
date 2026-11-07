export type LibraryType = 'real' | 'anime'

export type GarmentCategory
  = | 'spring'
    | 'summer'
    | 'autumn'
    | 'winter'
    | 'lingerie'
    | 'party'
    | 'swimwear'
    | 'sexy'

export interface Garment {
  id: string // real:SPR-0001 / anime:SPR-0001
  original_id: string
  library: LibraryType
  category: GarmentCategory
  category_zh?: string
  title: string
  keywords: string[]
  thumbnail_url: string
  image_url: string
  original_url?: string
  is_favorite?: boolean
}

export interface GarmentQuery {
  library: LibraryType
  category?: GarmentCategory | 'all'
  q?: string
  page: number
  page_size: number
}

export interface PageResult<T> {
  list: T[]
  page: number
  page_size: number
  total: number
  has_more: boolean
}

export interface ModelPortrait {
  id: string
  name: string
  thumbnail_url: string
  image_url: string
  original_url?: string
  category?: string
  hairstyle?: string
  tags: string[]
  sec?: string
  secZh?: string
}

export interface CategoryItem {
  key: GarmentCategory | 'all'
  name: string
  icon?: string
}
