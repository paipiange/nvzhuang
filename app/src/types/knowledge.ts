export type KnowledgeCategory
  = | 'all'
    | 'anime-guide' // 二次元穿搭与风格
    | 'tryon-tips' // AI 换装避坑秘籍
    | 'prompt-lexicon' // 提示词词典与正负词
    | 'pose-gallery' // 姿势工坊与出片联动
    | 'models-workflow' // 模型与工作流解析

export interface PromptItem {
  label: string
  zh: string
  en: string
  category?: string
  tags?: string[]
}

export interface KnowledgeSection {
  heading: string
  content: string[]
  tips?: string[]
  prompts?: PromptItem[]
  highlight?: string
  image?: string
  action?: {
    text: string
    type: 'gallery' | 'tryon' | 'models' | 'external'
    payload?: string
  }
}

export interface KnowledgeArticle {
  id: string
  slug: string
  title: string
  subtitle: string
  category: KnowledgeCategory
  categoryZh: string
  readTime: string
  featured?: boolean
  coverImage: string
  summary: string
  tags: string[]
  updatedAt: string
  sections: KnowledgeSection[]
  relatedGarmentIds?: string[]
}

export interface KnowledgeCategoryItem {
  key: KnowledgeCategory
  name: string
  icon: string
  desc: string
}
