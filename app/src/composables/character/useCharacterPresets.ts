import { readonly, shallowRef } from 'vue'
import { CHARACTERS, FACES, OUTFITS, POSES } from './catalog'

export const CHARACTER_PRESETS_STORAGE_KEY = 'nvzhuang:companion-character-presets:v1'
const MAX_PRESETS = 10
const MAX_LABEL = 30

export interface CharacterPreset {
  id: string
  label: string
  characterId: string
  faceId: string
  outfitId: string
  outfitLibrary: 'real' | 'anime'
  poseId: string
  createdAt: number
}

export type CharacterPresetProfile = Pick<CharacterPreset, 'characterId' | 'faceId' | 'outfitId' | 'outfitLibrary' | 'poseId'>
export type CharacterPresetRestoreMode = 'merge' | 'replace'

function cleanLabel(value: unknown) {
  return typeof value === 'string'
    ? Array.from(value).filter(character => character.charCodeAt(0) >= 32).join('').trim().slice(0, MAX_LABEL)
    : ''
}

function sanitize(value: unknown): CharacterPreset | undefined {
  if (!value || typeof value !== 'object')
    return undefined
  const item = value as Partial<CharacterPreset>
  const label = cleanLabel(item.label)
  if (!label || typeof item.id !== 'string' || !/^preset-\d{1,16}-\d{1,4}$/.test(item.id))
    return undefined
  if (!CHARACTERS.some(character => character.id === item.characterId) || !FACES.some(face => face.id === item.faceId))
    return undefined
  if (!OUTFITS.some(outfit => outfit.id === item.outfitId && outfit.library === item.outfitLibrary) || !POSES.some(pose => pose.id === item.poseId))
    return undefined
  if (typeof item.createdAt !== 'number' || !Number.isFinite(item.createdAt))
    return undefined
  return {
    id: item.id,
    label,
    characterId: item.characterId,
    faceId: item.faceId,
    outfitId: item.outfitId,
    outfitLibrary: item.outfitLibrary,
    poseId: item.poseId,
    createdAt: item.createdAt,
  }
}

function readStored() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CHARACTER_PRESETS_STORAGE_KEY) : typeof uni !== 'undefined' ? uni.getStorageSync(CHARACTER_PRESETS_STORAGE_KEY) : null
    const parsed = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw
    return Array.isArray(parsed) ? parsed.map(sanitize).filter((item): item is CharacterPreset => !!item).slice(0, MAX_PRESETS) : []
  }
  catch {
    return []
  }
}

function persist(entries: CharacterPreset[]) {
  try {
    const value = JSON.stringify(entries)
    if (typeof localStorage !== 'undefined')
      localStorage.setItem(CHARACTER_PRESETS_STORAGE_KEY, value)
    else if (typeof uni !== 'undefined')
      uni.setStorageSync(CHARACTER_PRESETS_STORAGE_KEY, value)
  }
  catch {}
}

function presetSequence(id: string) {
  const match = /-(\d{1,4})$/.exec(id)
  return match ? Number(match[1]) : 0
}

function labelKey(label: string) {
  return label.toLocaleLowerCase()
}

export function useCharacterPresets() {
  const entries = shallowRef(readStored())
  let sequence = Math.max(0, ...entries.value.map(item => presetSequence(item.id)))

  function save(label: string, profile: CharacterPresetProfile) {
    const createdAt = Date.now()
    const preset = sanitize({ ...profile, id: `preset-${createdAt}-${++sequence}`, label, createdAt })
    if (!preset || entries.value.some(item => labelKey(item.label) === labelKey(preset.label)))
      return undefined
    entries.value = [preset, ...entries.value].slice(0, MAX_PRESETS)
    persist(entries.value)
    return preset
  }

  function remove(id: string) {
    const removed = entries.value.find(item => item.id === id)
    if (!removed)
      return undefined
    const next = entries.value.filter(item => item.id !== id)
    entries.value = next
    persist(next)
    return { ...removed }
  }

  function rename(id: string, label: string) {
    const index = entries.value.findIndex(item => item.id === id)
    const nextLabel = cleanLabel(label)
    if (index < 0 || !nextLabel || entries.value.some(item => item.id !== id && labelKey(item.label) === labelKey(nextLabel)))
      return undefined
    const next = entries.value.slice()
    next[index] = { ...next[index], label: nextLabel }
    entries.value = next
    persist(next)
    return next[index]
  }

  function copy(id: string, label = '') {
    if (entries.value.length >= MAX_PRESETS)
      return undefined
    const source = entries.value.find(item => item.id === id)
    if (!source)
      return undefined
    const requested = cleanLabel(label)
    const nextLabel = requested && requested !== source.label ? requested : cleanLabel(`${source.label} 副本`)
    return save(nextLabel, source)
  }

  function clear() {
    entries.value = []
    persist([])
  }

  function importEntries(imported: readonly CharacterPreset[], mode: CharacterPresetRestoreMode) {
    if (!Array.isArray(imported) || imported.length > MAX_PRESETS || !['merge', 'replace'].includes(mode))
      throw new Error('造型预设恢复参数无效。')
    const normalized = imported.map(sanitize)
    if (normalized.some(item => !item))
      throw new Error('造型预设包含无效条目。')
    const safe = normalized as CharacterPreset[]
    const importedLabels = safe.map(item => labelKey(item.label))
    if (new Set(importedLabels).size !== importedLabels.length)
      throw new Error('造型预设名称重复。')
    if (mode === 'merge') {
      const importedIds = new Set(safe.map(item => item.id))
      const existingLabels = new Set(entries.value.filter(item => !importedIds.has(item.id)).map(item => labelKey(item.label)))
      if (importedLabels.some(label => existingLabels.has(label)))
        throw new Error('造型预设名称与现有预设重复。')
    }
    if (mode === 'replace') {
      entries.value = safe
    }
    else {
      const importedIds = new Set(safe.map(item => item.id))
      entries.value = [...safe, ...entries.value.filter(item => !importedIds.has(item.id))].slice(0, MAX_PRESETS)
    }
    sequence = Math.max(sequence, ...entries.value.map(item => presetSequence(item.id)))
    persist(entries.value)
    return safe.length
  }

  return { entries: readonly(entries), save, rename, copy, remove, clear, importEntries }
}
