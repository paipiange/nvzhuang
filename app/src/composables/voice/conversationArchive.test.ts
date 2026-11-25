import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConversationArchive } from './conversationArchive'

describe('conversation archive', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(Math, 'random').mockReturnValue(0.25)
  })

  it('stores bounded text only and restores valid local entries', () => {
    const now = Date.now()
    const archive = useConversationArchive()
    archive.append('linxi', '你好\u0000', '你好呀', now)
    expect(archive.entries.value[0]).toMatchObject({ characterId: 'linxi', userText: '你好', assistantText: '你好呀', createdAt: now })
    expect(JSON.stringify(archive.entries.value)).not.toContain('api_key')
    expect(useConversationArchive().entries.value).toHaveLength(1)
  })

  it('drops unexpected fields from restored local data', () => {
    localStorage.setItem('nvzhuang:companion-transcripts:v1', JSON.stringify([{
      id: '1',
      characterId: 'linxi',
      userText: 'hello',
      assistantText: 'hi',
      createdAt: 1,
      api_key: 'must-not-survive',
    }]))
    expect(useConversationArchive().exportJson()).not.toContain('must-not-survive')
  })

  it('caps history count and rejects damaged persisted data', () => {
    const archive = useConversationArchive()
    for (let index = 0; index < 60; index++)
      archive.append('zhixia', `第${index}轮`, '回复', index)
    expect(archive.entries.value).toHaveLength(50)
    localStorage.setItem('nvzhuang:companion-transcripts:v1', '{bad json')
    expect(useConversationArchive().entries.value).toEqual([])
  })

  it('exports and supports per-character and full privacy erasure', () => {
    const archive = useConversationArchive()
    archive.append('linxi', 'A', 'B', 1)
    archive.append('zhixia', 'C', 'D', 2)
    expect(JSON.parse(archive.exportJson()).entries).toHaveLength(2)
    archive.clearCharacter('linxi')
    expect(archive.entries.value.map(item => item.characterId)).toEqual(['zhixia'])
    archive.clearAll()
    expect(archive.entries.value).toEqual([])
  })

  it('deletes one local conversation without affecting other records', () => {
    const archive = useConversationArchive()
    archive.setRetentionDays(0)
    archive.append('linxi', 'A', 'B', 1)
    archive.append('zhixia', 'C', 'D', 2)
    const target = archive.entries.value[0].id

    expect(archive.removeEntry(target)).toMatchObject({ id: target, characterId: 'linxi' })
    expect(archive.entries.value).toHaveLength(1)
    expect(archive.entries.value[0].characterId).toBe('zhixia')
    expect(archive.removeEntry(target)).toBeUndefined()
    expect(useConversationArchive().entries.value).toEqual(archive.entries.value)
  })

  it('toggles and persists a local favorite flag', () => {
    const archive = useConversationArchive()
    archive.setRetentionDays(0)
    archive.append('linxi', '收藏', '这条', 1)
    const id = archive.entries.value[0].id

    expect(archive.toggleFavorite(id)).toBe(true)
    expect(useConversationArchive().entries.value[0].favorite).toBe(true)
    expect(archive.toggleFavorite(id)).toBe(false)
    expect(archive.toggleFavorite('missing')).toBeUndefined()
  })

  it('searches only requested character text with a bounded result set', () => {
    const archive = useConversationArchive()
    archive.append('linxi', '今天穿蓝色', '很适合你', 1)
    archive.append('zhixia', '蓝色裙子', '可以试试', 2)
    expect(archive.search('蓝色', 'linxi').map(item => item.characterId)).toEqual(['linxi'])
    expect(archive.search('不存在')).toEqual([])
    expect(archive.search('')).toEqual([])
  })

  it('returns the newest local conversations without requiring a search query', () => {
    const archive = useConversationArchive()
    archive.setRetentionDays(0)
    archive.append('linxi', '较早', '一', 1)
    archive.append('zhixia', '其他角色', '二', 2)
    archive.append('linxi', '最新', '三', 3)

    expect(archive.recent('linxi').map(item => item.userText)).toEqual(['最新', '较早'])
    expect(archive.recent('', 1).map(item => item.userText)).toEqual(['最新'])
  })

  it('lists only favorited records for the selected character', () => {
    const archive = useConversationArchive()
    archive.setRetentionDays(0)
    archive.append('linxi', '未收藏', '一', 1)
    archive.append('zhixia', '其他角色收藏', '二', 2)
    archive.append('linxi', '当前角色收藏', '三', 3)
    archive.toggleFavorite(archive.entries.value[1].id)
    archive.toggleFavorite(archive.entries.value[2].id)

    expect(archive.favorites('linxi').map(item => item.userText)).toEqual(['当前角色收藏'])
    expect(JSON.parse(archive.exportJson('favorites')).entries.map((item: { userText: string }) => item.userText)).toEqual(['其他角色收藏', '当前角色收藏'])
  })

  it('clears unfavorited records while preserving favorites', () => {
    const archive = useConversationArchive()
    archive.setRetentionDays(0)
    archive.append('linxi', '删除', '一', 1)
    archive.append('zhixia', '保留', '二', 2)
    archive.toggleFavorite(archive.entries.value[1].id)

    expect(archive.clearUnfavorited()).toBe(1)
    expect(archive.entries.value).toMatchObject([{ userText: '保留', favorite: true }])
    expect(archive.clearUnfavorited()).toBe(0)
  })

  it('imports versioned JSON, normalizes extra fields, and rejects invalid data', () => {
    const now = Date.now()
    const archive = useConversationArchive()
    const count = archive.importJson(JSON.stringify({ version: 1, entries: [{ id: 'import-1', characterId: 'linxi', userText: '你好', assistantText: '欢迎', createdAt: now, api_key: 'drop-me' }] }))
    expect(count).toBe(1)
    expect(archive.entries.value[0]).toEqual({ id: 'import-1', characterId: 'linxi', userText: '你好', assistantText: '欢迎', createdAt: now, favorite: false })
    expect(archive.exportJson()).not.toContain('drop-me')
    expect(JSON.parse(archive.exportJson())).toMatchObject({ version: 2, entries: [{ favorite: false }] })
    expect(() => archive.importJson(JSON.stringify({ version: 2, entries: [{ id: 'import-2', characterId: 'linxi', userText: '你好', assistantText: '欢迎', createdAt: now }] }))).toThrow('包含无效')
    expect(() => archive.importJson('{bad')).toThrow('JSON 格式无效')
    expect(() => archive.importJson(JSON.stringify({ version: 3, entries: [] }))).toThrow('版本或结构无效')
  })

  it('prunes records using a local retention policy', () => {
    const now = new Date('2026-11-22T00:00:00Z').getTime()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    localStorage.setItem('nvzhuang:companion-transcripts:v1', JSON.stringify([
      { id: 'old', characterId: 'linxi', userText: 'old', assistantText: '', createdAt: now - 31 * 86400000 },
      { id: 'favorite-old', characterId: 'linxi', userText: 'favorite', assistantText: '', createdAt: now - 60 * 86400000, favorite: true },
      { id: 'new', characterId: 'linxi', userText: 'new', assistantText: '', createdAt: now - 2 * 86400000 },
    ]))
    const archive = useConversationArchive()
    expect(archive.entries.value.map(item => item.id)).toEqual(['favorite-old', 'new'])
    expect(archive.setRetentionDays(0)).toBe(true)
    expect(archive.retentionDays.value).toBe(0)
    expect(archive.setRetentionDays(8)).toBe(false)
  })

  it('restores records in merge and replace modes', () => {
    const archive = useConversationArchive()
    archive.setRetentionDays(0)
    archive.append('zhixia', '现有', '记录', 100)
    const imported = { id: 'imported', characterId: 'linxi', userText: '导入', assistantText: '记录', createdAt: 200 }
    expect(archive.restoreEntries([imported], 'merge')).toBe(1)
    expect(archive.entries.value).toHaveLength(2)
    expect(archive.restoreEntries([imported], 'replace')).toBe(1)
    expect(archive.entries.value).toEqual([{ ...imported, favorite: false }])
  })
})

afterEach(() => vi.restoreAllMocks())
