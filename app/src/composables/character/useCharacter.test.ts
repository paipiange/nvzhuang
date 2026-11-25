import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHARACTERS, FACES, OUTFITS, POSES } from './catalog'
import { createStaticAvatarRenderer } from './staticAvatar'
import { requestPortrait } from './portrait'
import { CHARACTER_STORAGE_KEY, useCharacter } from './useCharacter'

vi.mock('./portrait', () => ({ requestPortrait: vi.fn() }))

const samplePortrait = { imageUrl: 'data:image/png;base64,AA==', mime: 'image/png', model: 'test' }

beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key), setItem: (key: string, value: string) => store.set(key, value) })
  vi.mocked(requestPortrait).mockReset()
})

afterEach(() => vi.unstubAllGlobals())

describe('companion character', () => {
  it('restores only catalog IDs and switches every identity field together', () => {
    localStorage.setItem(CHARACTER_STORAGE_KEY, JSON.stringify({ faceId: 'https://external.invalid/private.webp', voiceId: 'custom', poseId: '../private', apiKey: 'fake', outfitId: 'SPR-0001', outfitLibrary: 'unknown' }))
    const character = useCharacter()
    expect(character.profile.value).toMatchObject({ characterId: 'zhixia', voiceId: 'zhixia', outfitId: 'SPR-0001', outfitLibrary: 'real', poseId: 'natural' })
    expect(character.face.value?.id).toBe(CHARACTERS[0].faceId)
    expect(character.changeFace(FACES[2].id)).toBe(true)
    expect(character.changeCharacter('linxi')).toBe(true)
    const { id, label, ...profile } = CHARACTERS[1]
    expect({ id, label }).toEqual({ id: 'linxi', label: '林溪' })
    expect(character.profile.value).toEqual(profile)
    expect(useCharacter().profile.value).toEqual(profile)
    expect(localStorage.getItem(CHARACTER_STORAGE_KEY)).not.toMatch(/https|apiKey|custom/)
  })

  it('matches only whole commands, supports numbered and library-qualified outfits, and rejects unknown assets', () => {
    const character = useCharacter()
    const snapshot = character.profile.value
    expect(character.applyIntent('请告诉我怎么换成 12 号衣服')).toBeNull()
    expect(character.applyIntent('换成 9999 号衣服')).toEqual({ ok: false, kind: 'outfit' })
    expect(character.changeFace('../face')).toBe(false)
    expect(character.changeOutfit('SPR-0001', 'bad' as 'real')).toBe(false)
    expect(character.changePose('constructor')).toBe(false)
    expect(character.changeCharacter('not-found')).toBe(false)
    expect(character.profile.value).toBe(snapshot)
    expect(character.assetError.value).toBe('avatar_asset_missing')
    expect(character.applyIntent('换成 12 号衣服。')).toEqual({ ok: true, kind: 'outfit' })
    expect(character.outfit.value?.id).toBe(OUTFITS.filter(item => item.library === 'real')[11].id)
    expect(character.applyIntent('换成二次元 SPR-0001 衣服')).toEqual({ ok: true, kind: 'outfit' })
    expect(character.outfit.value?.library).toBe('anime')
    expect(character.applyIntent('换成挥手打招呼姿势')).toEqual({ ok: true, kind: 'pose' })
    expect(character.profile.value.poseId).toBe('wave')
    expect(character.assetError.value).toBe('')
  })

  it('does not let a completed snapshot overwrite a newer selection', async () => {
    let complete: (value: typeof samplePortrait) => void = () => {}
    vi.mocked(requestPortrait).mockImplementationOnce(() => new Promise((resolve) => {
      complete = resolve
    }))
    const character = useCharacter()
    const old = character.generatePortrait()
    expect(character.portraitStatus.value).toBe('generating')
    await character.generatePortrait()
    expect(requestPortrait).toHaveBeenCalledTimes(1)
    expect(character.changePose(POSES[1].id)).toBe(true)
    expect(vi.mocked(requestPortrait).mock.calls[0][1].aborted).toBe(false)
    complete(samplePortrait)
    expect(await old).toEqual(samplePortrait)
    expect(character.portrait.value).toBeUndefined()
    expect(character.portraitStatus.value).toBe('idle')
  })

  it('retains the previously rendered portrait on service failure and only retries when asked', async () => {
    vi.mocked(requestPortrait).mockResolvedValueOnce(samplePortrait).mockRejectedValueOnce(new Error('model unavailable'))
    const character = useCharacter()
    await character.generatePortrait()
    expect(character.portrait.value).toEqual(samplePortrait)
    await character.generatePortrait()
    expect(character.portraitStatus.value).toBe('failed')
    expect(character.portraitErrorCode.value).toBe('portrait_generation_failed')
    expect(character.portrait.value).toEqual(samplePortrait)
    expect(requestPortrait).toHaveBeenCalledTimes(2)
    expect(character.profile.value.characterId).toBe('zhixia')
    character.clearPortrait()
    expect(character.portrait.value).toBeUndefined()
    expect(character.portraitStatus.value).toBe('idle')
    expect(character.portraitError.value).toBe('')
  })

  it('resets the visible character to the catalog default', () => {
    const character = useCharacter()
    character.changeCharacter('linxi')
    character.changePose('sitting')
    character.resetCharacter()
    expect(character.profile.value).toMatchObject({ characterId: 'zhixia', poseId: 'natural' })
    expect(JSON.parse(localStorage.getItem(CHARACTER_STORAGE_KEY) || '{}')).toMatchObject({ characterId: 'zhixia', poseId: 'natural' })
  })

  it('restores a validated in-memory portrait result with its catalog snapshot', () => {
    const character = useCharacter()
    const snapshot = { ...character.profile.value, poseId: 'heart' }
    expect(character.usePortraitResult(snapshot, { imageUrl: 'data:image/png;base64,AAAA', mime: 'image/png', model: 'test' })).toBe(true)
    expect(character.profile.value.poseId).toBe('heart')
    expect(character.portrait.value?.imageUrl).toBe('data:image/png;base64,AAAA')
    expect(character.usePortraitResult(snapshot, { imageUrl: 'https://external.invalid/private.png', mime: 'image/png', model: 'test' })).toBe(false)
  })

  it('bounds static animation input and ignores updates after disposal', async () => {
    const { renderer, model, poseId, outfitId, speaking, rms } = createStaticAvatarRenderer()
    await expect(renderer.load('unknown')).rejects.toThrow('avatar_asset_missing')
    await renderer.load('linxi-static')
    renderer.setPose('sitting')
    await renderer.setOutfit('SPR-0002')
    renderer.setExpression('speaking')
    renderer.feedAudioLevel(17)
    expect([model.value.id, poseId.value, outfitId.value, speaking.value, rms.value]).toEqual(['linxi', 'sitting', 'SPR-0002', true, 1])
    renderer.dispose()
    renderer.feedAudioLevel(Number.POSITIVE_INFINITY)
    renderer.setExpression('speaking')
    expect([speaking.value, rms.value]).toEqual([false, 0])
  })
})
