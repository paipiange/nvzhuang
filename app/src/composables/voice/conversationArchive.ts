import { readonly, ref, shallowRef } from 'vue'

export const CONVERSATION_ARCHIVE_STORAGE_KEY = 'nvzhuang:companion-transcripts:v1'
const MAX_ENTRIES = 50
const MAX_TEXT = 4000
const MAX_TOTAL_TEXT = 60000
const MAX_IMPORT_CHARS = 512 * 1024
export const CONVERSATION_RETENTION_STORAGE_KEY = 'nvzhuang:companion-transcript-retention:v1'
const RETENTION_DAYS = [0, 7, 30, 90] as const

export interface ConversationEntry {
  id: string
  characterId: string
  userText: string
  assistantText: string
  createdAt: number
  favorite?: boolean
}

export type ConversationRestoreMode = 'merge' | 'replace'

function cleanText(value: unknown) {
  return typeof value === 'string'
    ? Array.from(value).filter(character => character.charCodeAt(0) >= 32 || character === '\n' || character === '\t').join('').trim().slice(0, MAX_TEXT)
    : ''
}

function validEntry(value: unknown): value is ConversationEntry {
  if (!value || typeof value !== 'object')
    return false
  const item = value as Partial<ConversationEntry>
  return typeof item.id === 'string' && item.id.length <= 80
    && typeof item.characterId === 'string' && /^[\w-]{1,40}$/.test(item.characterId)
    && typeof item.userText === 'string' && item.userText.length <= MAX_TEXT
    && typeof item.assistantText === 'string' && item.assistantText.length <= MAX_TEXT
    && typeof item.createdAt === 'number' && Number.isFinite(item.createdAt)
    && (item.favorite === undefined || typeof item.favorite === 'boolean')
}

function readStored(): ConversationEntry[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CONVERSATION_ARCHIVE_STORAGE_KEY) : typeof uni !== 'undefined' ? uni.getStorageSync(CONVERSATION_ARCHIVE_STORAGE_KEY) : null
    const parsed = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw
    if (!Array.isArray(parsed))
      return []
    return parsed.filter(validEntry).slice(-MAX_ENTRIES).map(item => ({
      id: item.id,
      characterId: item.characterId,
      userText: item.userText,
      assistantText: item.assistantText,
      createdAt: item.createdAt,
      favorite: item.favorite === true,
    }))
  }
  catch {
    return []
  }
}

function persist(entries: ConversationEntry[]) {
  try {
    const value = JSON.stringify(entries)
    if (typeof localStorage !== 'undefined')
      localStorage.setItem(CONVERSATION_ARCHIVE_STORAGE_KEY, value)
    else if (typeof uni !== 'undefined')
      uni.setStorageSync(CONVERSATION_ARCHIVE_STORAGE_KEY, value)
  }
  catch {}
}

function readRetentionDays() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CONVERSATION_RETENTION_STORAGE_KEY) : typeof uni !== 'undefined' ? uni.getStorageSync(CONVERSATION_RETENTION_STORAGE_KEY) : null
    if (raw === null || raw === undefined || raw === '')
      return 30
    const days = Number(raw)
    return RETENTION_DAYS.includes(days as typeof RETENTION_DAYS[number]) ? days : 30
  }
  catch {
    return 30
  }
}

function pruneRetention(entries: ConversationEntry[], days: number, now = Date.now()) {
  if (!days)
    return entries
  const cutoff = now - days * 24 * 60 * 60 * 1000
  return entries.filter(item => item.favorite === true || item.createdAt >= cutoff)
}

function bound(entries: ConversationEntry[]) {
  const result: ConversationEntry[] = []
  let total = 0
  for (const entry of entries.slice(-MAX_ENTRIES).reverse()) {
    const size = entry.userText.length + entry.assistantText.length
    if (total + size > MAX_TOTAL_TEXT)
      continue
    total += size
    result.push(entry)
  }
  return result.reverse()
}

export function useConversationArchive() {
  const retentionDays = ref(readRetentionDays())
  const entries = shallowRef(bound(pruneRetention(readStored(), retentionDays.value)))
  persist(entries.value)

  function append(characterId: string, userText: string, assistantText: string, createdAt = Date.now()) {
    const safeCharacter = /^[\w-]{1,40}$/.test(characterId) ? characterId : 'unknown'
    const user = cleanText(userText)
    const assistant = cleanText(assistantText)
    if (!user && !assistant)
      return
    const entry: ConversationEntry = { id: `${createdAt}-${Math.random().toString(36).slice(2, 10)}`, characterId: safeCharacter, userText: user, assistantText: assistant, createdAt, favorite: false }
    entries.value = bound([...entries.value, entry])
    persist(entries.value)
  }

  function clearCharacter(characterId: string) {
    entries.value = entries.value.filter(item => item.characterId !== characterId)
    persist(entries.value)
  }

  function removeEntry(id: string) {
    if (!id)
      return undefined
    const removed = entries.value.find(item => item.id === id)
    if (!removed)
      return undefined
    const next = entries.value.filter(item => item.id !== id)
    entries.value = next
    persist(next)
    return { ...removed }
  }

  function toggleFavorite(id: string) {
    const index = entries.value.findIndex(item => item.id === id)
    if (index < 0)
      return undefined
    const next = entries.value.slice()
    next[index] = { ...next[index], favorite: next[index].favorite !== true }
    entries.value = next
    persist(next)
    return next[index].favorite === true
  }

  function clearAll() {
    entries.value = []
    persist(entries.value)
  }

  function clearUnfavorited(characterId = '') {
    const next = entries.value.filter(item => item.favorite === true || (characterId && item.characterId !== characterId))
    const removed = entries.value.length - next.length
    if (removed) {
      entries.value = next
      persist(next)
    }
    return removed
  }

  function exportJson(scope: 'all' | 'favorites' = 'all') {
    const selected = scope === 'favorites' ? entries.value.filter(item => item.favorite === true) : entries.value
    return JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), entries: selected }, null, 2)
  }

  function search(query: string, characterId = '') {
    const keyword = cleanText(query).slice(0, 100).toLocaleLowerCase()
    if (!keyword)
      return []
    return entries.value.filter(item => (!characterId || item.characterId === characterId)
      && `${item.userText}\n${item.assistantText}`.toLocaleLowerCase().includes(keyword)).slice(-20).reverse()
  }

  function recent(characterId = '', limit = 20) {
    const safeLimit = Math.min(20, Math.max(1, Math.trunc(limit) || 20))
    return entries.value.filter(item => !characterId || item.characterId === characterId).slice(-safeLimit).reverse()
  }

  function favorites(characterId = '', limit = 20) {
    const safeLimit = Math.min(20, Math.max(1, Math.trunc(limit) || 20))
    return entries.value.filter(item => item.favorite === true && (!characterId || item.characterId === characterId)).slice(-safeLimit).reverse()
  }

  function importJson(raw: string) {
    if (!raw || raw.length > MAX_IMPORT_CHARS)
      throw new Error('对话记录文件为空或过大。')
    let payload: unknown
    try {
      payload = JSON.parse(raw)
    }
    catch {
      throw new Error('对话记录 JSON 格式无效。')
    }
    const version = payload && typeof payload === 'object' ? (payload as { version?: unknown }).version : undefined
    if (!payload || typeof payload !== 'object' || ![1, 2].includes(version as number) || !Array.isArray((payload as { entries?: unknown }).entries))
      throw new Error('对话记录版本或结构无效。')
    const imported = (payload as { entries: unknown[] }).entries
    if (imported.length > MAX_ENTRIES || imported.some(item => !validEntry(item) || (version === 2 && typeof (item as ConversationEntry).favorite !== 'boolean')))
      throw new Error('对话记录包含无效或过量条目。')
    const normalized = imported.map((item) => {
      const valid = item as ConversationEntry
      return { id: valid.id, characterId: valid.characterId, userText: valid.userText, assistantText: valid.assistantText, createdAt: valid.createdAt, favorite: valid.favorite === true }
    })
    return restoreEntries(normalized, 'merge')
  }

  function restoreEntries(imported: readonly ConversationEntry[], mode: ConversationRestoreMode) {
    if (!Array.isArray(imported) || imported.length > MAX_ENTRIES || !['merge', 'replace'].includes(mode) || imported.some(item => !validEntry(item)))
      throw new Error('对话记录恢复参数无效。')
    const normalized = imported.map(item => ({
      id: item.id,
      characterId: item.characterId,
      userText: item.userText,
      assistantText: item.assistantText,
      createdAt: item.createdAt,
      favorite: item.favorite === true,
    }))
    let source: ConversationEntry[] = normalized
    if (mode === 'merge') {
      const byId = new Map(entries.value.map(item => [item.id, item]))
      normalized.forEach(item => byId.set(item.id, item))
      source = [...byId.values()]
    }
    entries.value = bound(pruneRetention(source.sort((left, right) => left.createdAt - right.createdAt), retentionDays.value))
    persist(entries.value)
    return normalized.length
  }

  function setRetentionDays(days: number) {
    if (!RETENTION_DAYS.includes(days as typeof RETENTION_DAYS[number]))
      return false
    retentionDays.value = days
    entries.value = bound(pruneRetention(entries.value, days))
    persist(entries.value)
    try {
      if (typeof localStorage !== 'undefined')
        localStorage.setItem(CONVERSATION_RETENTION_STORAGE_KEY, String(days))
      else if (typeof uni !== 'undefined')
        uni.setStorageSync(CONVERSATION_RETENTION_STORAGE_KEY, days)
    }
    catch {}
    return true
  }

  return { entries: readonly(entries), retentionDays: readonly(retentionDays), append, removeEntry, toggleFavorite, clearCharacter, clearAll, clearUnfavorited, exportJson, search, recent, favorites, importJson, restoreEntries, setRetentionDays }
}
