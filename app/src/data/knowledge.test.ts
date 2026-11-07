import { describe, expect, it } from 'vitest'
import {
  getFeaturedKnowledgeArticles,
  getKnowledgeArticleById,
  getKnowledgeArticles,
  KNOWLEDGE_ARTICLES,
  KNOWLEDGE_CATEGORIES,
} from './knowledge'

describe('knowledge Base Data & Utilities', () => {
  it('知识库分类必须包含全部、二次元穿搭与换装避坑等基础分类', () => {
    expect(KNOWLEDGE_CATEGORIES.length).toBeGreaterThanOrEqual(5)
    const keys = KNOWLEDGE_CATEGORIES.map(c => c.key)
    expect(keys).toContain('all')
    expect(keys).toContain('anime-guide')
    expect(keys).toContain('tryon-tips')
    expect(keys).toContain('prompt-lexicon')
    expect(keys).toContain('pose-gallery')
    expect(keys).toContain('models-workflow')
  })

  it('收录的文章必须具备合法结构，且图片地址符合 paipiange.github.io/nvzhuang 资产规范', () => {
    expect(KNOWLEDGE_ARTICLES.length).toBeGreaterThanOrEqual(6)
    for (const article of KNOWLEDGE_ARTICLES) {
      expect(article.id).toBeTruthy()
      expect(article.title).toBeTruthy()
      expect(article.category).toBeTruthy()
      expect(article.sections.length).toBeGreaterThan(0)
      expect(article.coverImage).toMatch(/^https:\/\/paipiange\.github\.io\/nvzhuang\/assets\//)
    }
  })

  it('getKnowledgeArticles 按分类正确过滤', () => {
    const all = getKnowledgeArticles('all')
    expect(all.length).toBe(KNOWLEDGE_ARTICLES.length)

    const animeArticles = getKnowledgeArticles('anime-guide')
    expect(animeArticles.length).toBeGreaterThan(0)
    for (const art of animeArticles) {
      expect(art.category).toBe('anime-guide')
    }
  })

  it('getKnowledgeArticleById 能够按 ID 或 Slug 精确查出对应文章', () => {
    const found = getKnowledgeArticleById('kb-anime-style-guide')
    expect(found).toBeDefined()
    expect(found?.title).toContain('二次元')

    const bySlug = getKnowledgeArticleById('anime-style-guide')
    expect(bySlug).toBeDefined()
    expect(bySlug?.id).toBe('kb-anime-style-guide')

    const notFound = getKnowledgeArticleById('non-existent-id')
    expect(notFound).toBeUndefined()
  })

  it('getFeaturedKnowledgeArticles 返回精选且数量合理', () => {
    const featured = getFeaturedKnowledgeArticles()
    expect(featured.length).toBeGreaterThan(0)
    for (const f of featured) {
      expect(f.featured).toBe(true)
    }
  })
})
