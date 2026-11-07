import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { TryonDraft, TryonJob, TryonSize } from '@/types/tryon'
import type { Garment, ModelPortrait } from '@/types/garment'

const HISTORY_KEY = 'nvzhuang:history:v1'

export const useTryonStore = defineStore('tryon', () => {
  const draft = ref<TryonDraft>({
    garmentId: null,
    garmentImageUrl: null,
    garmentTitle: null,
    personLocalPath: null,
    personFileId: null,
    selectedPortraitId: null,
    selectedPortraitUrl: null,
    modelKey: 'gemini',
    size: '1024x1536',
    keepFace: true,
  })

  const history = ref<TryonJob[]>([])
  const currentJob = ref<TryonJob | null>(null)

  const initHistory = () => {
    try {
      const stored = uni.getStorageSync(HISTORY_KEY)
      if (Array.isArray(stored)) {
        history.value = stored
      }
      else if (typeof stored === 'string' && stored) {
        history.value = JSON.parse(stored)
      }
    }
    catch (e) {
      console.warn('Failed to load tryon history', e)
    }
  }

  const persistHistory = () => {
    try {
      uni.setStorageSync(HISTORY_KEY, history.value)
    }
    catch (e) {
      console.warn('Failed to persist tryon history', e)
    }
  }

  const setGarment = (garment: Garment) => {
    draft.value.garmentId = garment.id
    draft.value.garmentImageUrl = garment.image_url || garment.thumbnail_url
    draft.value.garmentTitle = garment.title
  }

  const setPortrait = (portrait: ModelPortrait) => {
    draft.value.selectedPortraitId = portrait.id
    draft.value.selectedPortraitUrl = portrait.image_url || portrait.thumbnail_url
    // 清空本地上传路径，二选一
    draft.value.personLocalPath = null
    draft.value.personFileId = null
  }

  const setPersonPhoto = (localPath: string) => {
    draft.value.personLocalPath = localPath
    // 清空模特选择，二选一
    draft.value.selectedPortraitId = null
    draft.value.selectedPortraitUrl = null
  }

  const setModel = (modelKey: string) => {
    draft.value.modelKey = modelKey
  }

  const setSize = (size: TryonSize) => {
    draft.value.size = size
  }

  const setKeepFace = (val: boolean) => {
    draft.value.keepFace = val
  }

  const clearDraft = () => {
    draft.value.personLocalPath = null
    draft.value.personFileId = null
    draft.value.selectedPortraitId = null
    draft.value.selectedPortraitUrl = null
  }

  const addHistory = (job: TryonJob) => {
    // 限制历史最多 50 条
    history.value.unshift(job)
    if (history.value.length > 50) {
      history.value = history.value.slice(0, 50)
    }
    persistHistory()
  }

  const deleteHistory = (id: string) => {
    const idx = history.value.findIndex(item => item.id === id)
    if (idx > -1) {
      history.value.splice(idx, 1)
      persistHistory()
    }
  }

  const clearHistory = () => {
    history.value = []
    persistHistory()
  }

  initHistory()

  return {
    draft,
    history,
    currentJob,
    setGarment,
    setPortrait,
    setPersonPhoto,
    setModel,
    setSize,
    setKeepFace,
    clearDraft,
    addHistory,
    deleteHistory,
    clearHistory,
    initHistory,
  }
})
