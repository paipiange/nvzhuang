import { CHARACTERS, FACES, OUTFITS, POSES } from '@/composables/character/catalog'
import type { CharacterPreset } from '@/composables/character/useCharacterPresets'
import type { ConversationEntry } from '@/composables/voice/conversationArchive'
import type { VoiceProvider } from '@/composables/voice/useVoiceProviderPreference'

export const COMPANION_BACKUP_KIND = 'nvzhuang-companion-backup'
export const COMPANION_BACKUP_VERSION = 3

export interface BackupIntegrity {
  algorithm: 'crc32'
  checksum: string
}

export interface BackupCharacter {
  characterId: string
  faceId: string
  outfitId: string
  outfitLibrary: 'real' | 'anime'
  poseId: string
}

export interface CompanionBackup {
  kind: typeof COMPANION_BACKUP_KIND
  version: typeof COMPANION_BACKUP_VERSION
  exportedAt: string
  character: BackupCharacter
  presets: CharacterPreset[]
  conversations: ConversationEntry[]
  preferences: { retentionDays: number, voiceProvider: VoiceProvider }
  integrity: BackupIntegrity
}

export interface CompanionBackupInput {
  character: BackupCharacter
  presets: readonly CharacterPreset[]
  conversations: readonly ConversationEntry[]
  retentionDays: number
  voiceProvider: VoiceProvider
}

export interface CompanionBackupCurrentState {
  presets: readonly CharacterPreset[]
  conversations: readonly ConversationEntry[]
}

export interface CompanionBackupSummary {
  exportedAt: string
  characterLabel: string
  presetCount: number
  conversationCount: number
  textChars: number
  retentionDays: number
  voiceProvider: VoiceProvider
  merge: {
    newPresets: number
    updatedPresets: number
    conflictingPresets: number
    newConversations: number
    updatedConversations: number
    conflictingConversations: number
  }
  replace: {
    removedPresets: number
    removedConversations: number
  }
  integrity: BackupIntegrity
}

const URL_PATTERN = /(?:\b(?:https?|wss?|ftp):\/\/|\bwww\.|\b(?:data|blob|file):)[^\s<>"']+/giu
const CREDENTIAL_PATTERN = /\b(?:sk-[\w-]{8,}|AIza[\w-]{8,}|Bearer\s+[\w.~-]{8,}|(?:api[_-]?key|token|password|secret)\s*[:=]\s*["']?[^\s,"'}]{4,})/giu
const MAX_BACKUP_CHARS = 1024 * 1024
type BackupPayload = Record<string, unknown>
type BackupMigration = (payload: BackupPayload) => BackupPayload

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++)
    value = (value & 1) !== 0 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function canonicalize(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalize).join(',')}]`
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function utf8Bytes(value: string) {
  const bytes: number[] = []
  for (const character of value) {
    const code = character.codePointAt(0) || 0
    if (code <= 0x7F) {
      bytes.push(code)
    }
    else if (code <= 0x7FF) {
      bytes.push(0xC0 | (code >>> 6), 0x80 | (code & 0x3F))
    }
    else if (code <= 0xFFFF) {
      bytes.push(0xE0 | (code >>> 12), 0x80 | ((code >>> 6) & 0x3F), 0x80 | (code & 0x3F))
    }
    else {
      bytes.push(0xF0 | (code >>> 18), 0x80 | ((code >>> 12) & 0x3F), 0x80 | ((code >>> 6) & 0x3F), 0x80 | (code & 0x3F))
    }
  }
  return bytes
}

function crc32(value: string) {
  let checksum = 0xFFFFFFFF
  for (const byte of utf8Bytes(value))
    checksum = CRC32_TABLE[(checksum ^ byte) & 0xFF] ^ (checksum >>> 8)
  return ((checksum ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0')
}

function contentWithoutIntegrity(payload: object) {
  const { integrity: _integrity, ...content } = payload as BackupPayload
  return content
}

function createIntegrity(payload: object): BackupIntegrity {
  return { algorithm: 'crc32', checksum: crc32(canonicalize(contentWithoutIntegrity(payload))) }
}

function withIntegrity<T extends object>(payload: T): T & { integrity: BackupIntegrity } {
  return { ...payload, integrity: createIntegrity(payload) }
}

function cleanText(value: unknown) {
  if (typeof value !== 'string')
    return ''
  return Array.from(value)
    .filter(character => character.charCodeAt(0) >= 32 || character === '\n' || character === '\t')
    .join('')
    .replace(URL_PATTERN, '[已移除链接]')
    .replace(CREDENTIAL_PATTERN, '[已移除凭据]')
    .trim()
    .slice(0, 4000)
}

function validCharacter(value: BackupCharacter) {
  return CHARACTERS.some(item => item.id === value.characterId)
    && FACES.some(item => item.id === value.faceId)
    && OUTFITS.some(item => item.id === value.outfitId && item.library === value.outfitLibrary)
    && POSES.some(item => item.id === value.poseId)
}

function sanitizeCharacter(value: BackupCharacter): BackupCharacter {
  const fallback = CHARACTERS[0]
  const candidate = {
    characterId: value.characterId,
    faceId: value.faceId,
    outfitId: value.outfitId,
    outfitLibrary: value.outfitLibrary,
    poseId: value.poseId,
  }
  if (validCharacter(candidate))
    return candidate
  return {
    characterId: fallback.characterId,
    faceId: fallback.faceId,
    outfitId: fallback.outfitId,
    outfitLibrary: fallback.outfitLibrary,
    poseId: fallback.poseId,
  }
}

function sanitizePresets(entries: readonly CharacterPreset[]) {
  return entries.slice(0, 10).flatMap((item) => {
    const character = {
      characterId: item.characterId,
      faceId: item.faceId,
      outfitId: item.outfitId,
      outfitLibrary: item.outfitLibrary,
      poseId: item.poseId,
    }
    const label = cleanText(item.label).replace(/[\r\n\t]/g, ' ').slice(0, 30)
    if (!label || !validCharacter(character) || !/^preset-\d{1,16}-\d{1,4}$/.test(item.id) || !Number.isFinite(item.createdAt))
      return []
    return [{ id: item.id, label, ...character, createdAt: item.createdAt }]
  })
}

function sanitizeConversations(entries: readonly ConversationEntry[]) {
  let totalText = 0
  return entries.slice(-50).flatMap((item) => {
    if (!/^[\w-]{1,80}$/.test(item.id) || !/^[\w-]{1,40}$/.test(item.characterId) || !Number.isFinite(item.createdAt))
      return []
    const userText = cleanText(item.userText)
    const assistantText = cleanText(item.assistantText)
    if (!userText && !assistantText)
      return []
    const size = userText.length + assistantText.length
    if (totalText + size > 60000)
      return []
    totalText += size
    return [{ id: item.id, characterId: item.characterId, userText, assistantText, createdAt: item.createdAt, favorite: item.favorite === true }]
  })
}

export function createCompanionBackup(input: CompanionBackupInput, now = new Date()): CompanionBackup {
  const voiceProvider = ['local', 'seeduplex', 'open-llm-vtuber'].includes(input.voiceProvider) ? input.voiceProvider : 'local'
  const retentionDays = [0, 7, 30, 90].includes(input.retentionDays) ? input.retentionDays : 30
  const payload: Omit<CompanionBackup, 'integrity'> = {
    kind: COMPANION_BACKUP_KIND,
    version: COMPANION_BACKUP_VERSION,
    exportedAt: now.toISOString(),
    character: sanitizeCharacter(input.character),
    presets: sanitizePresets(input.presets),
    conversations: sanitizeConversations(input.conversations),
    preferences: { retentionDays, voiceProvider },
  }
  return withIntegrity(payload)
}

function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every(key => keys.includes(key))
}

function migrateV1ToV2(payload: BackupPayload) {
  if (!hasExactKeys(payload, ['kind', 'version', 'exportedAt', 'character', 'presets', 'conversations', 'preferences']) || !Array.isArray(payload.conversations))
    throw new Error('陪伴备份 v1 结构无效，无法安全迁移。')
  const conversations = payload.conversations.map((raw) => {
    const item = objectValue(raw)
    if (!item || !hasExactKeys(item, ['id', 'characterId', 'userText', 'assistantText', 'createdAt']))
      throw new Error('陪伴备份 v1 对话字段无效，无法安全迁移。')
    return { ...item, favorite: false }
  })
  return { ...payload, version: 2, conversations }
}

function migrateV2ToV3(payload: BackupPayload) {
  if (!hasExactKeys(payload, ['kind', 'version', 'exportedAt', 'character', 'presets', 'conversations', 'preferences']))
    throw new Error('陪伴备份 v2 结构无效，无法安全迁移。')
  return withIntegrity({ ...payload, version: 3 })
}

const COMPANION_BACKUP_MIGRATIONS: Readonly<Record<number, BackupMigration>> = Object.freeze({
  1: migrateV1ToV2,
  2: migrateV2ToV3,
})
export const COMPANION_BACKUP_MIGRATION_VERSIONS = Object.freeze(Object.keys(COMPANION_BACKUP_MIGRATIONS).map(Number))

function migrateCompanionBackupPayload(payload: BackupPayload) {
  if (typeof payload.version !== 'number' || !Number.isInteger(payload.version))
    throw new Error('陪伴备份版本无效。')
  if (payload.version > COMPANION_BACKUP_VERSION)
    throw new Error(`陪伴备份版本 ${payload.version} 高于当前支持版本 ${COMPANION_BACKUP_VERSION}，请升级应用后再恢复。`)
  if (payload.version < 1)
    throw new Error(`陪伴备份版本 ${payload.version} 已停止支持，请先使用兼容版本转换。`)
  let migrated = payload
  while ((migrated.version as number) < COMPANION_BACKUP_VERSION) {
    const version = migrated.version as number
    const migration = COMPANION_BACKUP_MIGRATIONS[version]
    if (!migration)
      throw new Error(`陪伴备份版本 ${version} 缺少安全迁移路径，请使用兼容版本处理。`)
    const next = migration(migrated)
    if (next.version !== version + 1)
      throw new Error(`陪伴备份版本 ${version} 迁移结果无效。`)
    migrated = next
  }
  return migrated
}

function parseCharacter(value: unknown) {
  const item = objectValue(value)
  if (!item || !hasExactKeys(item, ['characterId', 'faceId', 'outfitId', 'outfitLibrary', 'poseId']))
    throw new Error('备份角色结构无效。')
  const character = {
    characterId: item.characterId,
    faceId: item.faceId,
    outfitId: item.outfitId,
    outfitLibrary: item.outfitLibrary,
    poseId: item.poseId,
  } as BackupCharacter
  if (Object.values(character).some(field => typeof field !== 'string') || !validCharacter(character))
    throw new Error('备份角色不在当前目录中。')
  return character
}

function parsePresets(value: unknown) {
  if (!Array.isArray(value) || value.length > 10)
    throw new Error('备份造型预设数量无效。')
  const ids = new Set<string>()
  return value.map((raw) => {
    const item = objectValue(raw)
    if (!item || !hasExactKeys(item, ['id', 'label', 'characterId', 'faceId', 'outfitId', 'outfitLibrary', 'poseId', 'createdAt']))
      throw new Error('备份造型预设字段无效。')
    const character = parseCharacter({
      characterId: item.characterId,
      faceId: item.faceId,
      outfitId: item.outfitId,
      outfitLibrary: item.outfitLibrary,
      poseId: item.poseId,
    })
    const label = cleanText(item.label).replace(/[\r\n\t]/g, ' ').slice(0, 30)
    if (label !== item.label || typeof item.id !== 'string' || !/^preset-\d{1,16}-\d{1,4}$/.test(item.id) || typeof item.createdAt !== 'number' || !Number.isFinite(item.createdAt))
      throw new Error('备份造型预设内容无效。')
    if (ids.has(item.id))
      throw new Error('备份造型预设标识重复。')
    ids.add(item.id)
    return { id: item.id, label, ...character, createdAt: item.createdAt }
  })
}

function parseConversations(value: unknown) {
  if (!Array.isArray(value) || value.length > 50)
    throw new Error('备份对话记录数量无效。')
  let totalText = 0
  const ids = new Set<string>()
  return value.map((raw) => {
    const item = objectValue(raw)
    if (!item || !hasExactKeys(item, ['id', 'characterId', 'userText', 'assistantText', 'createdAt', 'favorite']))
      throw new Error('备份对话记录字段无效。')
    const userText = cleanText(item.userText)
    const assistantText = cleanText(item.assistantText)
    if (userText !== item.userText || assistantText !== item.assistantText || (!userText && !assistantText))
      throw new Error('备份对话包含未脱敏或无效文本。')
    if (typeof item.id !== 'string' || !/^[\w-]{1,80}$/.test(item.id) || typeof item.characterId !== 'string' || !/^[\w-]{1,40}$/.test(item.characterId) || typeof item.createdAt !== 'number' || !Number.isFinite(item.createdAt))
      throw new Error('备份对话记录标识无效。')
    if (typeof item.favorite !== 'boolean')
      throw new Error('备份对话收藏字段无效。')
    if (ids.has(item.id))
      throw new Error('备份对话记录标识重复。')
    ids.add(item.id)
    totalText += userText.length + assistantText.length
    if (totalText > 60000)
      throw new Error('备份对话文本过大。')
    return { id: item.id, characterId: item.characterId, userText, assistantText, createdAt: item.createdAt, favorite: item.favorite === true }
  })
}

function parseIntegrity(value: unknown, payload: BackupPayload) {
  const integrity = objectValue(value)
  if (!integrity || !hasExactKeys(integrity, ['algorithm', 'checksum']) || integrity.algorithm !== 'crc32' || typeof integrity.checksum !== 'string' || !/^[a-f0-9]{8}$/.test(integrity.checksum))
    throw new Error('备份完整性校验信息无效。')
  const expected = createIntegrity(payload)
  if (integrity.checksum !== expected.checksum)
    throw new Error('备份完整性校验失败，文件可能已损坏或被修改。')
  return expected
}

export function parseCompanionBackup(raw: string): CompanionBackup {
  if (!raw || raw.length > MAX_BACKUP_CHARS)
    throw new Error('陪伴备份为空或过大。')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  }
  catch {
    throw new Error('陪伴备份 JSON 格式无效。')
  }
  const initialPayload = objectValue(parsed)
  if (!initialPayload || initialPayload.kind !== COMPANION_BACKUP_KIND)
    throw new Error('陪伴备份版本或结构无效。')
  const payload = migrateCompanionBackupPayload(initialPayload)
  if (!hasExactKeys(payload, ['kind', 'version', 'exportedAt', 'character', 'presets', 'conversations', 'preferences', 'integrity']) || payload.version !== COMPANION_BACKUP_VERSION)
    throw new Error('陪伴备份版本或结构无效。')
  const integrity = parseIntegrity(payload.integrity, payload)
  if (typeof payload.exportedAt !== 'string' || payload.exportedAt.length > 40 || !Number.isFinite(Date.parse(payload.exportedAt)))
    throw new Error('陪伴备份时间无效。')
  const preferences = objectValue(payload.preferences)
  if (!preferences || !hasExactKeys(preferences, ['retentionDays', 'voiceProvider']) || typeof preferences.retentionDays !== 'number' || ![0, 7, 30, 90].includes(preferences.retentionDays) || typeof preferences.voiceProvider !== 'string' || !['local', 'seeduplex', 'open-llm-vtuber'].includes(preferences.voiceProvider))
    throw new Error('陪伴备份偏好设置无效。')
  return {
    kind: COMPANION_BACKUP_KIND,
    version: COMPANION_BACKUP_VERSION,
    exportedAt: payload.exportedAt,
    character: parseCharacter(payload.character),
    presets: parsePresets(payload.presets),
    conversations: parseConversations(payload.conversations),
    preferences: {
      retentionDays: preferences.retentionDays,
      voiceProvider: preferences.voiceProvider as VoiceProvider,
    },
    integrity,
  }
}

export function summarizeCompanionBackup(backup: CompanionBackup, current: CompanionBackupCurrentState): CompanionBackupSummary {
  const currentPresets = new Map(current.presets.map(item => [item.id, item]))
  const currentConversations = new Map(current.conversations.map(item => [item.id, item]))
  const currentPresetIds = new Set(currentPresets.keys())
  const currentConversationIds = new Set(currentConversations.keys())
  const backupPresetIds = new Set(backup.presets.map(item => item.id))
  const backupConversationIds = new Set(backup.conversations.map(item => item.id))
  const updatedPresets = backup.presets.filter(item => currentPresetIds.has(item.id)).length
  const updatedConversations = backup.conversations.filter(item => currentConversationIds.has(item.id)).length
  const conflictingPresets = backup.presets.filter((item) => {
    const existing = currentPresets.get(item.id)
    return existing !== undefined && canonicalize(existing) !== canonicalize(item)
  }).length
  const conflictingConversations = backup.conversations.filter((item) => {
    const existing = currentConversations.get(item.id)
    return existing !== undefined && canonicalize(existing) !== canonicalize(item)
  }).length

  return {
    exportedAt: backup.exportedAt,
    characterLabel: CHARACTERS.find(item => item.id === backup.character.characterId)?.label || '目录角色',
    presetCount: backup.presets.length,
    conversationCount: backup.conversations.length,
    textChars: backup.conversations.reduce((total, item) => total + item.userText.length + item.assistantText.length, 0),
    retentionDays: backup.preferences.retentionDays,
    voiceProvider: backup.preferences.voiceProvider,
    merge: {
      newPresets: backup.presets.length - updatedPresets,
      updatedPresets,
      conflictingPresets,
      newConversations: backup.conversations.length - updatedConversations,
      updatedConversations,
      conflictingConversations,
    },
    replace: {
      removedPresets: current.presets.filter(item => !backupPresetIds.has(item.id)).length,
      removedConversations: current.conversations.filter(item => !backupConversationIds.has(item.id)).length,
    },
    integrity: backup.integrity,
  }
}
