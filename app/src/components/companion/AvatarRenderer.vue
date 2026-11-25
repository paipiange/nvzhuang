<script setup lang="ts">
import type { OutfitLibrary } from '@/composables/character/useCharacter'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import { FACES, OUTFITS } from '@/composables/character/catalog'
import { createDynamicAvatarRenderer } from '@/composables/character/dynamicAvatar'

const props = defineProps<{
  modelId: string
  faceSrc?: string
  portraitSrc?: string
  poseId?: string
  outfitId?: string
  outfitLibrary?: OutfitLibrary
  speaking?: boolean
  audioLevel?: number
}>()

const { renderer, model, poseId, outfitId, speaking, rms, mouthShape, mouthOpenness, eyesClosed, breath, headTilt, runtimeMode } = createDynamicAvatarRenderer()
const missing = shallowRef<string[]>([])
const avatarSrc = computed(() => [props.portraitSrc, props.faceSrc, FACES.find(item => item.id === model.value.faceId)?.src, '/static/images/default-avatar.png']
  .find(src => src && !missing.value.includes(src)))
const outfitPreview = computed(() => OUTFITS.find(item => item.id === outfitId.value && item.library === (props.outfitLibrary ?? model.value.outfitLibrary)))
const motionStyle = computed(() => ({
  '--avatar-breath': `${breath.value}px`,
  '--avatar-tilt': `${headTilt.value}deg`,
  '--mouth-open': Math.max(0.12, mouthOpenness.value).toFixed(3),
  '--audio-scale': (1 + rms.value * 2).toFixed(3),
}))
const runtimeLabel = computed(() => runtimeMode.value === 'dynamic2d'
  ? '动态 2D · 音量嘴型'
  : runtimeMode.value === 'reduced-motion'
    ? '减少动态模式'
    : '静态降级')

watch(() => props.modelId, id => void renderer.load(id).catch(() => {}), { immediate: true })
watch(() => props.poseId ?? model.value.poseId, renderer.setPose, { immediate: true })
watch(() => props.outfitId ?? model.value.outfitId, id => void renderer.setOutfit(id), { immediate: true })
watch(() => props.speaking, active => renderer.setExpression(active ? 'speaking' : 'neutral'), { immediate: true })
watch(() => props.audioLevel ?? 0, renderer.feedAudioLevel, { immediate: true })
watch(() => [props.modelId, props.faceSrc, props.portraitSrc], () => {
  missing.value = []
})
onScopeDispose(renderer.dispose)

function markMissing() {
  if (avatarSrc.value)
    missing.value = [...missing.value, avatarSrc.value]
}
</script>

<template>
  <view class="avatar-stage overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-800" :class="[{ 'avatar-speaking': speaking, 'avatar-generated': avatarSrc === portraitSrc, 'avatar-eyes-closed': eyesClosed }, `pose-${poseId}`, `runtime-${runtimeMode}`]" :style="motionStyle">
    <view v-if="avatarSrc" class="avatar-motion-layer">
      <image :key="avatarSrc" class="avatar-image" :src="avatarSrc" mode="aspectFit" role="img" :aria-label="`${model.displayName}的${avatarSrc === portraitSrc ? '生成写真' : '动态 2D 形象'}`" @error="markMissing" />
      <view v-if="runtimeMode === 'dynamic2d'" class="avatar-eyelids" aria-hidden="true">
        <view class="avatar-eyelid left" />
        <view class="avatar-eyelid right" />
      </view>
      <view v-if="speaking && runtimeMode !== 'static-fallback'" class="avatar-mouth" :class="`mouth-${mouthShape}`" aria-hidden="true" />
    </view>
    <text v-else class="avatar-fallback">
      {{ model.displayName }} · 暂无头像
    </text>
    <image v-if="outfitPreview && avatarSrc !== portraitSrc" class="outfit-preview" :src="outfitPreview.src" mode="aspectFit" role="img" :aria-label="`选择的服装参考：${outfitPreview.label}`" />
    <view v-if="speaking" class="avatar-indicator" aria-hidden="true" />
    <text class="avatar-runtime-label">{{ runtimeLabel }}</text>
  </view>
</template>

<style scoped>
.avatar-stage {
  position: relative;
  height: clamp(192px, 36vh, 340px);
}
.avatar-motion-layer {
  position: relative;
  width: 100%;
  height: 100%;
  transform: translateY(var(--avatar-breath)) rotate(var(--avatar-tilt));
  transform-origin: 50% 72%;
  transition: transform 80ms linear;
}
.avatar-image {
  display: block;
  width: 100%;
  height: 100%;
}
.avatar-fallback {
  display: grid;
  height: 100%;
  place-items: center;
}
.outfit-preview {
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 52px;
  height: 60px;
  border-radius: 8px;
}
.avatar-indicator {
  position: absolute;
  bottom: 12px;
  left: calc(50% - 8px);
  width: 16px;
  height: 5px;
  border-radius: 12px;
  background: var(--wot-color-theme, #7635d1);
}
.avatar-speaking .avatar-indicator {
  transform: scaleY(var(--audio-scale));
  transition: transform 90ms ease;
}
.avatar-runtime-label {
  position: absolute;
  top: 10px;
  left: 10px;
  padding: 3px 7px;
  border: 1px solid rgb(255 255 255 / 45%);
  border-radius: 999px;
  color: white;
  background: rgb(17 24 39 / 62%);
  font-size: 10px;
  line-height: 1.4;
  backdrop-filter: blur(4px);
}
.avatar-mouth {
  position: absolute;
  top: 34%;
  left: 50%;
  width: 13px;
  height: 12px;
  border: 1px solid rgb(255 255 255 / 48%);
  border-radius: 50%;
  background: rgb(102 24 48 / 82%);
  box-shadow: 0 1px 4px rgb(17 24 39 / 38%);
  transform: translate(-50%, -50%) scaleX(0.78) scaleY(var(--mouth-open));
  transform-origin: center;
  transition:
    width 80ms linear,
    height 80ms linear,
    transform 80ms linear;
}
.avatar-generated .avatar-mouth {
  top: 32%;
}
.mouth-medium {
  width: 15px;
  transform: translate(-50%, -50%) scaleX(0.9) scaleY(var(--mouth-open));
}
.mouth-wide {
  width: 18px;
  transform: translate(-50%, -50%) scaleX(1) scaleY(var(--mouth-open));
}
.avatar-eyelids {
  position: absolute;
  top: 27%;
  left: 50%;
  width: 54px;
  opacity: 0;
  transform: translateX(-50%);
  transition: opacity 45ms linear;
}
.avatar-generated .avatar-eyelids {
  top: 25%;
}
.avatar-eyes-closed .avatar-eyelids {
  opacity: 0.62;
}
.avatar-eyelid {
  position: absolute;
  top: 0;
  width: 17px;
  height: 3px;
  border-top: 2px solid rgb(59 30 38 / 75%);
  border-radius: 50%;
}
.avatar-eyelid.left {
  left: 4px;
}
.avatar-eyelid.right {
  right: 4px;
}
.runtime-static-fallback .avatar-motion-layer,
.runtime-reduced-motion .avatar-motion-layer {
  transform: none;
  transition: none;
}
@media (prefers-reduced-motion: reduce) {
  .avatar-motion-layer {
    transform: none;
    transition: none;
  }
  .avatar-mouth,
  .avatar-eyelids,
  .avatar-speaking .avatar-indicator {
    transition: none;
  }
  .avatar-speaking .avatar-indicator {
    transform: none;
  }
}
</style>
