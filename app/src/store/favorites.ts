import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

const STORAGE_KEY = 'nvzhuang:favorites:v1'

export const useFavoritesStore = defineStore('favorites', () => {
  const favoriteIds = ref<string[]>([])

  // 初始化从本地读取
  const init = () => {
    try {
      const stored = uni.getStorageSync(STORAGE_KEY)
      if (Array.isArray(stored)) {
        favoriteIds.value = stored
      }
      else if (typeof stored === 'string' && stored) {
        favoriteIds.value = JSON.parse(stored)
      }
    }
    catch (e) {
      console.warn('Failed to load favorites from storage', e)
    }
  }

  // 持久化
  const persist = () => {
    try {
      uni.setStorageSync(STORAGE_KEY, favoriteIds.value)
    }
    catch (e) {
      console.warn('Failed to persist favorites', e)
    }
  }

  const isFavorite = (id: string) => {
    return favoriteIds.value.includes(id)
  }

  const toggleFavorite = (id: string) => {
    const idx = favoriteIds.value.indexOf(id)
    let added = false
    if (idx > -1) {
      favoriteIds.value.splice(idx, 1)
      added = false
    }
    else {
      favoriteIds.value.unshift(id)
      added = true
    }
    persist()
    return added
  }

  const clearFavorites = () => {
    favoriteIds.value = []
    persist()
  }

  const count = computed(() => favoriteIds.value.length)

  // 立即执行一次初始化
  init()

  return {
    favoriteIds,
    count,
    isFavorite,
    toggleFavorite,
    clearFavorites,
    init,
  }
})
