import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CHARACTERS, FACES, OUTFITS, POSES } from './catalog'
import { CHARACTER_PRESETS_STORAGE_KEY, useCharacterPresets } from './useCharacterPresets'

const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) },
  })
})

afterEach(() => Reflect.deleteProperty(globalThis, 'localStorage'))

function sampleProfile() {
  return {
    characterId: CHARACTERS[0].id,
    faceId: FACES[0].id,
    outfitId: OUTFITS[0].id,
    outfitLibrary: OUTFITS[0].library,
    poseId: POSES[0].id,
  }
}

describe('useCharacterPresets', () => {
  it('stores only catalog IDs and bounds local presets', () => {
    const presets = useCharacterPresets()
    for (let index = 0; index < 12; index++)
      expect(presets.save(`造型 ${index}`, sampleProfile())).toBeDefined()
    expect(presets.entries.value).toHaveLength(10)
    expect(localStorage.getItem(CHARACTER_PRESETS_STORAGE_KEY)).not.toMatch(/https|apiKey|imageUrl/)
  })

  it('drops malformed fields and restores only the preset whitelist', () => {
    localStorage.setItem(CHARACTER_PRESETS_STORAGE_KEY, JSON.stringify([{
      ...sampleProfile(),
      id: 'preset-100-1',
      label: ' 日常\u0000造型 ',
      createdAt: 100,
      apiKey: 'drop-me',
      imageUrl: 'https://external.invalid/private.png',
    }, {
      ...sampleProfile(),
      id: 'preset-101-2',
      label: '非法造型',
      faceId: 'https://external.invalid/private.png',
      createdAt: 101,
    }]))
    const presets = useCharacterPresets()
    expect(presets.entries.value).toEqual([{ ...sampleProfile(), id: 'preset-100-1', label: '日常造型', createdAt: 100 }])
    expect(JSON.stringify(presets.entries.value)).not.toContain('drop-me')
  })

  it('removes a saved preset without touching unrelated storage', () => {
    localStorage.setItem('unrelated', 'keep')
    const presets = useCharacterPresets()
    const saved = presets.save('常用', sampleProfile())!
    expect(presets.remove(saved.id)).toMatchObject({ id: saved.id, label: saved.label })
    expect(presets.remove(saved.id)).toBeUndefined()
    expect(localStorage.getItem('unrelated')).toBe('keep')
  })

  it('restores presets in merge and replace modes', () => {
    const presets = useCharacterPresets()
    const existing = presets.save('现有造型', sampleProfile())!
    const imported = { ...sampleProfile(), id: 'preset-200-1', label: '导入造型', createdAt: 200 }
    expect(presets.importEntries([imported], 'merge')).toBe(1)
    expect(presets.entries.value.map(item => item.id)).toEqual([imported.id, existing.id])
    expect(presets.importEntries([imported], 'replace')).toBe(1)
    expect(presets.entries.value).toEqual([imported])
  })

  it('rejects duplicate labels across save, rename and restore paths', () => {
    const presets = useCharacterPresets()
    const first = presets.save('日常', sampleProfile())!
    const second = presets.save('约会', sampleProfile())!
    expect(presets.save(' 日常 ', sampleProfile())).toBeUndefined()
    expect(presets.rename(second.id, '日常')).toBeUndefined()
    expect(() => presets.importEntries([{ ...first, id: 'preset-3-3', label: '约会', createdAt: 3 }], 'merge')).toThrow('重复')
  })

  it('renames and copies only the preset whitelist while keeping the limit', () => {
    const presets = useCharacterPresets()
    const source = presets.save('原造型', sampleProfile())!
    const renamed = presets.rename(source.id, '  新造型\u0000  ')
    expect(renamed?.label).toBe('新造型')
    const copied = presets.copy(source.id)
    expect(copied).toMatchObject({ ...sampleProfile(), label: '新造型 副本' })
    expect(copied?.id).not.toBe(source.id)
    expect(JSON.stringify(copied)).not.toMatch(/imageUrl|apiKey|https:/)
    for (let index = presets.entries.value.length; index < 10; index++)
      presets.save(`造型 ${index}`, sampleProfile())
    expect(presets.copy(source.id)).toBeUndefined()
    expect(presets.entries.value).toHaveLength(10)
  })
})
