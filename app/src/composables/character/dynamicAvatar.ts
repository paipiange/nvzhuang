import type { AvatarRenderer } from './staticAvatar'
import { shallowRef } from 'vue'
import { CHARACTERS, OUTFITS, POSES } from './catalog'

export type AvatarMouthShape = 'closed' | 'small' | 'medium' | 'wide'
export type AvatarRuntimeMode = 'dynamic2d' | 'reduced-motion' | 'static-fallback'

export function normalizeAvatarAudioLevel(level: number) {
  return Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0
}

export function avatarMouthForLevel(level: number, speaking: boolean): { openness: number, shape: AvatarMouthShape } {
  if (!speaking)
    return { openness: 0, shape: 'closed' }
  const openness = Math.max(0.12, Math.min(1, Math.sqrt(normalizeAvatarAudioLevel(level)) * 1.8))
  const shape = openness >= 0.72 ? 'wide' : openness >= 0.42 ? 'medium' : 'small'
  return { openness, shape }
}

function reducedMotionPreferred() {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }
  catch {
    return false
  }
}

export function createDynamicAvatarRenderer() {
  const model = shallowRef(CHARACTERS[0])
  const poseId = shallowRef(model.value.poseId)
  const outfitId = shallowRef(model.value.outfitId)
  const speaking = shallowRef(false)
  const rms = shallowRef(0)
  const mouthShape = shallowRef<AvatarMouthShape>('closed')
  const mouthOpenness = shallowRef(0)
  const eyesClosed = shallowRef(false)
  const breath = shallowRef(0)
  const headTilt = shallowRef(0)
  const runtimeMode = shallowRef<AvatarRuntimeMode>(reducedMotionPreferred() ? 'reduced-motion' : 'dynamic2d')
  let disposed = false
  let smoothedLevel = 0
  const startedAt = Date.now()
  let nextBlinkAt = startedAt + 2400
  let blinkUntil = 0

  function updateMouth() {
    const mouth = avatarMouthForLevel(smoothedLevel, speaking.value)
    mouthShape.value = mouth.shape
    mouthOpenness.value = mouth.openness
  }

  const timer = setInterval(() => {
    if (disposed || runtimeMode.value !== 'dynamic2d')
      return
    const now = Date.now()
    if (now >= nextBlinkAt) {
      blinkUntil = now + 120
      nextBlinkAt = now + 2600 + ((now >>> 4) % 1800)
    }
    eyesClosed.value = now < blinkUntil
    const elapsed = (now - startedAt) / 1000
    breath.value = Math.sin(elapsed * Math.PI) * (speaking.value ? 0.75 : 0.35)
    const poseBias = poseId.value === 'profile' ? -1.2 : poseId.value === 'wave' || poseId.value === 'peace' ? 0.8 : 0
    headTilt.value = poseBias + Math.sin(elapsed * 1.35) * (speaking.value ? 0.8 : 0.25)
  }, 80)

  const renderer: AvatarRenderer = {
    async load(modelId) {
      const next = CHARACTERS.find(item => item.avatarModelId === modelId)
      if (!next) {
        if (!disposed)
          runtimeMode.value = 'static-fallback'
        throw new Error('avatar_asset_missing')
      }
      if (!disposed) {
        model.value = next
        runtimeMode.value = reducedMotionPreferred() ? 'reduced-motion' : 'dynamic2d'
      }
    },
    setExpression(name, weight = 1) {
      if (disposed)
        return
      speaking.value = name === 'speaking' && weight > 0
      updateMouth()
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
      if (disposed)
        return
      const normalized = normalizeAvatarAudioLevel(level)
      smoothedLevel = smoothedLevel * 0.58 + normalized * 0.42
      rms.value = smoothedLevel
      updateMouth()
    },
    dispose() {
      disposed = true
      clearInterval(timer)
      speaking.value = false
      rms.value = 0
      mouthShape.value = 'closed'
      mouthOpenness.value = 0
      eyesClosed.value = false
      breath.value = 0
      headTilt.value = 0
    },
  }

  return { renderer, model, poseId, outfitId, speaking, rms, mouthShape, mouthOpenness, eyesClosed, breath, headTilt, runtimeMode }
}
