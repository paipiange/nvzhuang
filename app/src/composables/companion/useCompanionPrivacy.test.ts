import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { COMPANION_STORAGE_KEYS, COMPANION_STORAGE_SOFT_LIMIT_BYTES, useCompanionPrivacy } from './useCompanionPrivacy'

const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
  })
})

afterEach(() => Reflect.deleteProperty(globalThis, 'localStorage'))

describe('useCompanionPrivacy', () => {
  it('counts values without exposing their contents', () => {
    localStorage.setItem(COMPANION_STORAGE_KEYS[0], 'private transcript')
    localStorage.setItem(COMPANION_STORAGE_KEYS[1], 'preset')
    const privacy = useCompanionPrivacy()
    expect(privacy.summary.value.entries).toBe(2)
    expect(privacy.summary.value.bytes).toBeGreaterThan(0)
    expect(privacy.summary.value).toMatchObject({ status: 'healthy', writable: true, readErrors: 0 })
    expect(privacy.summary.value.categories).toMatchObject([
      { key: 'character', entries: 2 },
      { key: 'conversation', entries: 0 },
      { key: 'audio', entries: 0 },
      { key: 'provider', entries: 0 },
    ])
    expect(privacy.summary.value.categories.reduce((total, item) => total + item.bytes, 0)).toBe(privacy.summary.value.bytes)
    expect(JSON.stringify(privacy.summary.value)).not.toContain('private transcript')
  })

  it('removes only known companion keys', () => {
    COMPANION_STORAGE_KEYS.forEach(key => localStorage.setItem(key, 'private'))
    localStorage.setItem('unrelated-business-data', 'keep')
    const privacy = useCompanionPrivacy()
    expect(privacy.clearLocalData()).toBe(COMPANION_STORAGE_KEYS.length)
    expect(privacy.summary.value).toMatchObject({ entries: 0, bytes: 0, status: 'healthy' })
    expect(localStorage.getItem('unrelated-business-data')).toBe('keep')
  })

  it('warns near the companion-only soft limit without reading unrelated keys', () => {
    localStorage.setItem(COMPANION_STORAGE_KEYS[0], 'x'.repeat(Math.ceil(COMPANION_STORAGE_SOFT_LIMIT_BYTES * 0.76)))
    localStorage.setItem('unrelated-business-data', 'private')
    const privacy = useCompanionPrivacy()

    expect(privacy.summary.value.status).toBe('warning')
    expect(privacy.summary.value.message).toContain('建议容量上限')
    expect(JSON.stringify(privacy.summary.value)).not.toContain('private')
  })

  it('reports storage write failures with a controlled message', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => { throw new Error('private storage failure') },
        removeItem: () => {},
      },
    })
    const privacy = useCompanionPrivacy()

    expect(privacy.summary.value).toMatchObject({ status: 'error', writable: false })
    expect(privacy.summary.value.message).not.toContain('private storage failure')
  })
})
