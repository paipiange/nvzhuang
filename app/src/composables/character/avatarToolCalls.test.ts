import { describe, expect, it, vi } from 'vitest'
import { useAvatarToolCalls } from './avatarToolCalls'

describe('avatarToolCalls', () => {
  it('applies only allowlisted calls with exact arguments', () => {
    const apply = vi.fn(() => true)
    const tools = useAvatarToolCalls(apply)

    expect(tools.execute({ name: 'change_pose', arguments: { id: 'wave' } })).toMatchObject({ ok: true, name: 'change_pose', kind: 'pose', code: 'ok' })
    expect(apply).toHaveBeenCalledWith({ kind: 'pose', id: 'wave' })

    expect(tools.execute({ name: 'change_pose', arguments: { id: 'wave', url: 'https://private.invalid' } }).code).toBe('invalid_call')
    expect(tools.execute({ name: 'open_url', arguments: { id: 'wave' } }).code).toBe('invalid_call')
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('rejects unknown catalog assets and keeps a privacy-safe bounded audit', () => {
    const apply = vi.fn(() => true)
    const tools = useAvatarToolCalls(apply, 2)

    expect(tools.execute({ name: 'change_character', arguments: { id: 'https://private.invalid/?token=secret' } }).code).toBe('asset_not_found')
    tools.execute({ name: 'change_outfit', arguments: { id: 'SPR-0001', library: 'real' } }, 'voice-intent')
    tools.execute({ name: 'change_face', arguments: { id: '../private' } })

    expect(tools.audit.value).toHaveLength(2)
    expect(tools.audit.value[0]).toMatchObject({ name: 'change_face', status: 'rejected', code: 'asset_not_found' })
    expect(tools.audit.value[1]).toMatchObject({ name: 'change_outfit', source: 'voice-intent', status: 'applied' })
    expect(JSON.stringify(tools.audit.value)).not.toMatch(/private|token|SPR-0001|\.\./)
    tools.clearAudit()
    expect(tools.audit.value).toEqual([])
  })
})
