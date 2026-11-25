import { describe, expect, it } from 'vitest'
import { COMPANION_BACKUP_MIGRATION_VERSIONS, createCompanionBackup, parseCompanionBackup, summarizeCompanionBackup } from './companionBackup'

describe('createCompanionBackup', () => {
  it('exports a versioned whitelist without credentials, audio, device ids or URLs', () => {
    const backup = createCompanionBackup({
      character: {
        characterId: 'zhixia',
        faceId: 'f000a1c4200',
        outfitId: 'SPR-0001',
        outfitLibrary: 'real',
        poseId: 'natural',
        imageUrl: 'https://private.invalid/photo.webp',
      },
      presets: [{
        id: 'preset-100-1',
        label: '日常造型 https://private.invalid',
        characterId: 'zhixia',
        faceId: 'f000a1c4200',
        outfitId: 'SPR-0001',
        outfitLibrary: 'real',
        poseId: 'natural',
        createdAt: 100,
        deviceId: 'private-device',
      }],
      conversations: [{
        id: '100-entry',
        characterId: 'zhixia',
        userText: '查看 https://private.invalid/?token=value',
        assistantText: 'api_key=private-value',
        createdAt: 100,
        audio: 'data:audio/wav;base64,private',
      }],
      retentionDays: 30,
      voiceProvider: 'seeduplex',
      apiKey: 'private-value',
      microphoneDeviceId: 'private-device',
    } as never, new Date('2026-11-22T00:00:00.000Z'))

    expect(backup).toMatchObject({
      kind: 'nvzhuang-companion-backup',
      version: 3,
      exportedAt: '2026-11-22T00:00:00.000Z',
      preferences: { retentionDays: 30, voiceProvider: 'seeduplex' },
      integrity: { algorithm: 'crc32', checksum: expect.stringMatching(/^[a-f0-9]{8}$/) },
    })
    const serialized = JSON.stringify(backup)
    expect(serialized).not.toMatch(/private\.invalid|private-value|private-device|imageUrl|audio|apiKey|microphoneDeviceId/)
    expect(serialized).toContain('[已移除链接]')
    expect(serialized).toContain('[已移除凭据]')
  })

  it('falls back to catalog defaults and bounded preference enums', () => {
    const backup = createCompanionBackup({
      character: { characterId: 'unknown', faceId: 'unknown', outfitId: 'unknown', outfitLibrary: 'real', poseId: 'unknown' },
      presets: [],
      conversations: [],
      retentionDays: 365,
      voiceProvider: 'private-provider',
    } as never)
    expect(backup.character.characterId).toBe('zhixia')
    expect(backup.preferences).toEqual({ retentionDays: 30, voiceProvider: 'local' })
  })

  it('strictly parses an exported backup and rejects extra or unsafe fields', () => {
    const backup = createCompanionBackup({
      character: { characterId: 'zhixia', faceId: 'f000a1c4200', outfitId: 'SPR-0001', outfitLibrary: 'real', poseId: 'natural' },
      presets: [],
      conversations: [{ id: 'entry-1', characterId: 'zhixia', userText: '你好', assistantText: '你好呀', createdAt: 100 }],
      retentionDays: 30,
      voiceProvider: 'local',
    }, new Date('2026-11-22T00:00:00.000Z'))
    expect(parseCompanionBackup(JSON.stringify(backup))).toEqual(backup)

    const { integrity: _integrity, ...legacyBase } = backup
    const legacyV2 = { ...legacyBase, version: 2 }
    const legacy = {
      ...legacyBase,
      version: 1,
      conversations: backup.conversations.map(item => ({
        id: item.id,
        characterId: item.characterId,
        userText: item.userText,
        assistantText: item.assistantText,
        createdAt: item.createdAt,
      })),
    }
    expect(parseCompanionBackup(JSON.stringify(legacy)).conversations[0].favorite).toBe(false)
    expect(parseCompanionBackup(JSON.stringify(legacyV2)).integrity.algorithm).toBe('crc32')
    expect(COMPANION_BACKUP_MIGRATION_VERSIONS).toEqual([1, 2])
    expect(() => parseCompanionBackup(JSON.stringify({ ...legacy, conversations: [{ ...legacy.conversations[0], unexpected: true }] }))).toThrow('v1 对话字段无效')
    expect(() => parseCompanionBackup(JSON.stringify({ ...backup, version: 4 }))).toThrow('高于当前支持版本 3')
    expect(() => parseCompanionBackup(JSON.stringify({ ...backup, version: 0 }))).toThrow('已停止支持')

    expect(() => parseCompanionBackup(JSON.stringify({ ...backup, apiKey: 'unexpected' }))).toThrow('版本或结构无效')
    expect(() => parseCompanionBackup(JSON.stringify({
      ...legacyV2,
      conversations: [{ ...backup.conversations[0], userText: 'https://unsafe.invalid' }],
    }))).toThrow('未脱敏或无效文本')
    expect(() => parseCompanionBackup(JSON.stringify({
      ...legacyV2,
      preferences: { retentionDays: 365, voiceProvider: 'local' },
    }))).toThrow('偏好设置无效')
    expect(() => parseCompanionBackup(JSON.stringify({
      ...backup,
      conversations: [{ ...backup.conversations[0], assistantText: '被修改' }],
    }))).toThrow('完整性校验失败')
  })

  it('summarizes restore impact without exposing transcript bodies or identifiers', () => {
    const backup = createCompanionBackup({
      character: { characterId: 'zhixia', faceId: 'f000a1c4200', outfitId: 'SPR-0001', outfitLibrary: 'real', poseId: 'natural' },
      presets: [{
        id: 'preset-100-1',
        label: '私密造型名',
        characterId: 'zhixia',
        faceId: 'f000a1c4200',
        outfitId: 'SPR-0001',
        outfitLibrary: 'real',
        poseId: 'natural',
        createdAt: 100,
      }],
      conversations: [{ id: 'private-entry', characterId: 'zhixia', userText: '私密提问', assistantText: '私密回答', createdAt: 100 }],
      retentionDays: 30,
      voiceProvider: 'seeduplex',
    }, new Date('2026-11-22T00:00:00.000Z'))

    const summary = summarizeCompanionBackup(backup, {
      presets: [{ ...backup.presets[0], label: '本机不同造型' }, {
        ...backup.presets[0],
        id: 'preset-200-1',
        label: '本机旧造型',
        createdAt: 200,
      }],
      conversations: [{ ...backup.conversations[0], assistantText: '本机不同回答' }, {
        ...backup.conversations[0],
        id: 'older-entry',
        createdAt: 200,
      }],
    })

    expect(summary).toEqual({
      exportedAt: '2026-11-22T00:00:00.000Z',
      characterLabel: '知夏',
      presetCount: 1,
      conversationCount: 1,
      textChars: 8,
      retentionDays: 30,
      voiceProvider: 'seeduplex',
      merge: { newPresets: 0, updatedPresets: 1, conflictingPresets: 1, newConversations: 0, updatedConversations: 1, conflictingConversations: 1 },
      replace: { removedPresets: 1, removedConversations: 1 },
      integrity: backup.integrity,
    })
    expect(JSON.stringify(summary)).not.toMatch(/私密|本机|private-entry|preset-100-1|older-entry/)
  })
})
