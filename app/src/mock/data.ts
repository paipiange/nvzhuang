import type { CategoryItem, Garment, ModelPortrait } from '@/types/garment'
import type { ModelOption } from '@/types/tryon'
import catalogLite from '@/static/data/catalog-lite.json'

export const CATEGORIES: CategoryItem[] = [
  { key: 'all', name: '全部' },
  { key: 'spring', name: '春装' },
  { key: 'summer', name: '夏装' },
  { key: 'autumn', name: '秋装' },
  { key: 'winter', name: '冬装' },
  { key: 'party', name: '宴会礼服' },
  { key: 'swimwear', name: '泳装' },
  { key: 'lingerie', name: '居家内着' },
  { key: 'sexy', name: '轻熟风' },
]

export const MODEL_OPTIONS: ModelOption[] = [
  {
    key: 'gemini',
    name: 'Gemini',
    icon: '✦',
    desc: 'Nano Banana 2 · 稳定推荐',
    badge: '推荐',
    enabled: true,
  },
  {
    key: 'doubao',
    name: '豆包',
    icon: '◕',
    desc: '火山方舟文生图 · 速度快',
    enabled: true,
  },
  {
    key: 'gpt-image',
    name: 'GPT Image',
    icon: '✧',
    desc: 'OpenAI 图像系列 · 细节丰富',
    enabled: true,
  },
  {
    key: 'comfyui',
    name: 'ComfyUI',
    icon: '◇',
    desc: '自建本地工作流 · 高可控',
    badge: '本地',
    enabled: true,
  },
]

export const MOCK_GARMENTS: Garment[] = (catalogLite.garments as Garment[]) || []
export const MOCK_PORTRAITS: ModelPortrait[] = (catalogLite.portraits as ModelPortrait[]) || []
