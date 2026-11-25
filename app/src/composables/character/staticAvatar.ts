import { shallowRef } from 'vue'
import { CHARACTERS, OUTFITS, POSES } from './catalog'

export interface AvatarRenderer {
  load: (modelId: string) => Promise<void>
  setExpression: (name: string, weight?: number) => void
  setPose: (poseId: string) => void
  setOutfit: (outfitId: string) => Promise<void>
  feedAudioLevel: (rms: number) => void
  dispose: () => void
}

export function createStaticAvatarRenderer() {
  const model = shallowRef(CHARACTERS[0])
  const poseId = shallowRef(model.value.poseId)
  const outfitId = shallowRef(model.value.outfitId)
  const speaking = shallowRef(false)
  const rms = shallowRef(0)
  let disposed = false

  const renderer: AvatarRenderer = {
    async load(modelId) {
      const next = CHARACTERS.find(item => item.avatarModelId === modelId)
      if (!next)
        throw new Error('avatar_asset_missing')
      if (!disposed)
        model.value = next
    },
    setExpression(name, weight = 1) {
      if (!disposed)
        speaking.value = name === 'speaking' && weight > 0
    },
    setPose(id) {
      if (!disposed && POSES.some(item => item.id === id))
        poseId.value = id
    },
    async setOutfit(id) {
      if (!disposed && OUTFITS.some(item => item.id === id))
        outfitId.value = id
    },
    feedAudioLevel(level) {
      if (!disposed)
        rms.value = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0
    },
    dispose() {
      disposed = true
      rms.value = 0
      speaking.value = false
    },
  }

  return { renderer, model, poseId, outfitId, speaking, rms }
}
