import type { CharacterAction, OutfitLibrary } from './character-state.mjs'
import type { GeneratedPortrait } from './portrait'
import { computed, getCurrentScope, onScopeDispose, readonly, shallowRef } from 'vue'
import { FACES, OUTFITS } from './catalog'
import { parseCharacterIntent, restoreCharacter, updateCharacter } from './character-state.mjs'
import { characterActionToToolCall, useAvatarToolCalls } from './avatarToolCalls'
import { requestPortrait } from './portrait'

export type { CharacterProfile, OutfitLibrary } from './character-state.mjs'
export type { GeneratedPortrait } from './portrait'

export const CHARACTER_STORAGE_KEY = 'mori-companion-character-v1'
const ASSET_ERROR = 'avatar_asset_missing'
const PORTRAIT_ERROR = 'portrait_generation_failed'

type PortraitStatus = 'idle' | 'generating' | 'success' | 'failed' | 'cancelled'

function samePortraitProfile(left: Readonly<{ characterId: string, faceId: string, outfitId: string, outfitLibrary: string, poseId: string }>, right: Readonly<{ characterId: string, faceId: string, outfitId: string, outfitLibrary: string, poseId: string }>) {
  return left.characterId === right.characterId
    && left.faceId === right.faceId
    && left.outfitId === right.outfitId
    && left.outfitLibrary === right.outfitLibrary
    && left.poseId === right.poseId
}

function validPortraitResult(result: GeneratedPortrait) {
  return ['image/jpeg', 'image/png', 'image/webp'].includes(result.mime)
    && result.imageUrl.startsWith(`data:${result.mime};base64,`)
    && result.imageUrl.length <= 25 * 1024 * 1024
    && typeof result.model === 'string'
    && result.model.length <= 100
}

function readProfile(): unknown {
  try {
    if (typeof localStorage !== 'undefined')
      return JSON.parse(localStorage.getItem(CHARACTER_STORAGE_KEY) || 'null')
    return uni.getStorageSync(CHARACTER_STORAGE_KEY)
  }
  catch {
    return null
  }
}

export function useCharacter() {
  const profile = shallowRef(restoreCharacter(readProfile(), FACES, OUTFITS))
  const face = computed(() => FACES.find(item => item.id === profile.value.faceId))
  const outfit = computed(() => OUTFITS.find(item => item.id === profile.value.outfitId && item.library === profile.value.outfitLibrary))
  const assetError = shallowRef('')
  const portrait = shallowRef<GeneratedPortrait>()
  const portraitStatus = shallowRef<PortraitStatus>('idle')
  const portraitError = shallowRef('')
  const portraitErrorCode = shallowRef('')
  let pending: AbortController | undefined

  function cancelPortrait() {
    if (!pending)
      return
    const cancelled = pending
    pending = undefined
    cancelled.abort()
    portraitStatus.value = 'cancelled'
  }

  function change(action: CharacterAction) {
    const next = updateCharacter(profile.value, action, FACES, OUTFITS)
    if (!next) {
      assetError.value = ASSET_ERROR
      return false
    }
    assetError.value = ''
    if (next === profile.value)
      return true
    portrait.value = undefined
    portraitStatus.value = 'idle'
    portraitError.value = ''
    portraitErrorCode.value = ''
    profile.value = next
    try {
      if (typeof localStorage !== 'undefined')
        localStorage.setItem(CHARACTER_STORAGE_KEY, JSON.stringify(next))
      else
        uni.setStorageSync(CHARACTER_STORAGE_KEY, next)
    }
    catch {
      assetError.value = 'character_storage_unavailable'
    }
    return true
  }

  const avatarTools = useAvatarToolCalls(change)

  async function generatePortrait(snapshot = profile.value, costAcknowledged = false): Promise<GeneratedPortrait | undefined> {
    if (pending)
      return undefined
    portraitError.value = ''
    portraitErrorCode.value = ''
    if (typeof AbortController !== 'function') {
      portraitStatus.value = 'failed'
      portraitErrorCode.value = PORTRAIT_ERROR
      portraitError.value = '当前平台暂不支持可取消的高清写真，请在浏览器中打开。'
      return undefined
    }
    const controller = new AbortController()
    pending = controller
    portraitStatus.value = 'generating'
    const timer = setTimeout(() => controller.abort(), 180_000)
    try {
      const generated = await requestPortrait(snapshot, controller.signal, costAcknowledged)
      if (pending !== controller)
        return undefined
      if (controller.signal.aborted)
        throw new Error('写真生成超时，可以手动重试。')
      if (samePortraitProfile(profile.value, snapshot)) {
        portrait.value = generated
        portraitStatus.value = 'success'
      }
      else {
        portraitStatus.value = 'idle'
      }
      return generated
    }
    catch (error) {
      if (pending === controller && samePortraitProfile(profile.value, snapshot)) {
        portraitStatus.value = 'failed'
        portraitErrorCode.value = PORTRAIT_ERROR
        portraitError.value = controller.signal.aborted
          ? '写真生成超时，可以手动重试。'
          : error instanceof Error ? error.message : '写真生成失败，可以手动重试。'
      }
      return undefined
    }
    finally {
      clearTimeout(timer)
      if (pending === controller)
        pending = undefined
      // Abort sibling gallery reads when the other reference failed.
      controller.abort()
    }
  }

  function usePortraitResult(snapshot: typeof profile.value, result: GeneratedPortrait) {
    const restored = restoreCharacter(snapshot, FACES, OUTFITS)
    if (!samePortraitProfile(restored, snapshot) || !validPortraitResult(result))
      return false
    profile.value = restored
    portrait.value = result
    portraitStatus.value = 'success'
    portraitError.value = ''
    portraitErrorCode.value = ''
    assetError.value = ''
    try {
      if (typeof localStorage !== 'undefined')
        localStorage.setItem(CHARACTER_STORAGE_KEY, JSON.stringify(restored))
      else
        uni.setStorageSync(CHARACTER_STORAGE_KEY, restored)
    }
    catch {
      assetError.value = 'character_storage_unavailable'
    }
    return true
  }

  function resetCharacter() {
    cancelPortrait()
    profile.value = restoreCharacter(null, FACES, OUTFITS)
    portrait.value = undefined
    portraitStatus.value = 'idle'
    portraitError.value = ''
    portraitErrorCode.value = ''
    assetError.value = ''
    try {
      if (typeof localStorage !== 'undefined')
        localStorage.setItem(CHARACTER_STORAGE_KEY, JSON.stringify(profile.value))
      else
        uni.setStorageSync(CHARACTER_STORAGE_KEY, profile.value)
    }
    catch {
      assetError.value = 'character_storage_unavailable'
    }
  }

  function clearPortrait() {
    cancelPortrait()
    portrait.value = undefined
    portraitStatus.value = 'idle'
    portraitError.value = ''
    portraitErrorCode.value = ''
  }

  if (getCurrentScope())
    onScopeDispose(cancelPortrait)

  return {
    profile: readonly(profile),
    face,
    outfit,
    portrait: readonly(portrait),
    assetError: readonly(assetError),
    portraitStatus: readonly(portraitStatus),
    portraitError: readonly(portraitError),
    portraitErrorCode: readonly(portraitErrorCode),
    changeCharacter: (id: string) => change({ kind: 'character', id }),
    changeFace: (id: string) => change({ kind: 'face', id }),
    changeOutfit: (id: string, library: OutfitLibrary) => change({ kind: 'outfit', id, library }),
    changePose: (id: string) => change({ kind: 'pose', id }),
    applyIntent(finalText: string) {
      const action = parseCharacterIntent(finalText, profile.value.outfitLibrary, OUTFITS)
      if (!action)
        return null
      const result = avatarTools.execute(characterActionToToolCall(action), 'voice-intent')
      return { ok: result.ok, kind: action.kind }
    },
    executeToolCall: avatarTools.execute,
    toolAudit: avatarTools.audit,
    clearToolAudit: avatarTools.clearAudit,
    generatePortrait,
    usePortraitResult,
    cancelPortrait,
    clearPortrait,
    resetCharacter,
  }
}
