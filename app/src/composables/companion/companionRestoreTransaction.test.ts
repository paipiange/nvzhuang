import { describe, expect, it, vi } from 'vitest'
import { executeCompanionRestoreTransaction } from './companionRestoreTransaction'

describe('executeCompanionRestoreTransaction', () => {
  it('keeps the applied state when every restore step succeeds', () => {
    const state = { value: 'before' }
    const rollback = vi.fn(() => {
      state.value = 'before'
    })

    const result = executeCompanionRestoreTransaction(() => {
      state.value = 'after'
    }, rollback)

    expect(result).toEqual({ ok: true })
    expect(state.value).toBe('after')
    expect(rollback).not.toHaveBeenCalled()
  })

  it('restores the snapshot when applying the backup fails', () => {
    const state = { value: 'before' }

    const result = executeCompanionRestoreTransaction(() => {
      state.value = 'partially-restored'
      throw new Error('restore failed')
    }, () => { state.value = 'before' })

    expect(result.ok).toBe(false)
    expect(result.error?.message).toBe('restore failed')
    expect(result.rollbackError).toBeUndefined()
    expect(state.value).toBe('before')
  })

  it('reports rollback failure without hiding the original restore error', () => {
    const result = executeCompanionRestoreTransaction(() => {
      throw new Error('restore failed')
    }, () => {
      throw new Error('rollback failed')
    })

    expect(result.error?.message).toBe('restore failed')
    expect(result.rollbackError?.message).toBe('rollback failed')
  })
})
