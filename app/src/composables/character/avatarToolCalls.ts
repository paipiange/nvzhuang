import type { CharacterAction, OutfitLibrary } from './character-state.mjs'
import { readonly, shallowRef } from 'vue'
import { CHARACTERS, FACES, OUTFITS, POSES } from './catalog'

export const AVATAR_TOOL_NAMES = Object.freeze(['change_character', 'change_face', 'change_outfit', 'change_pose'] as const)

export type AvatarToolName = typeof AVATAR_TOOL_NAMES[number]
export type AvatarToolSource = 'voice-intent' | 'assistant-tool'

export interface AvatarToolAuditEntry {
  id: number
  at: number
  source: AvatarToolSource
  name: AvatarToolName | 'rejected'
  status: 'applied' | 'rejected'
  code: 'ok' | 'invalid_call' | 'asset_not_found'
}

export interface AvatarToolResult {
  ok: boolean
  name?: AvatarToolName
  kind?: CharacterAction['kind']
  code: AvatarToolAuditEntry['code']
}

function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every(key => keys.includes(key))
}

function parseToolCall(value: unknown): { name: AvatarToolName, action: CharacterAction } | undefined {
  const call = objectValue(value)
  if (!call || !hasExactKeys(call, ['name', 'arguments']) || typeof call.name !== 'string' || !AVATAR_TOOL_NAMES.includes(call.name as AvatarToolName))
    return undefined
  const argumentsValue = objectValue(call.arguments)
  if (!argumentsValue)
    return undefined

  if (call.name === 'change_outfit') {
    if (!hasExactKeys(argumentsValue, ['id', 'library']) || typeof argumentsValue.id !== 'string' || (argumentsValue.library !== 'real' && argumentsValue.library !== 'anime'))
      return undefined
    if (!OUTFITS.some(item => item.id === argumentsValue.id && item.library === argumentsValue.library))
      return { name: call.name, action: { kind: 'outfit', id: '', library: argumentsValue.library as OutfitLibrary } }
    return { name: call.name, action: { kind: 'outfit', id: argumentsValue.id, library: argumentsValue.library as OutfitLibrary } }
  }

  if (!hasExactKeys(argumentsValue, ['id']) || typeof argumentsValue.id !== 'string')
    return undefined
  if (call.name === 'change_character')
    return { name: call.name, action: { kind: 'character', id: CHARACTERS.some(item => item.id === argumentsValue.id) ? argumentsValue.id : '' } }
  if (call.name === 'change_face')
    return { name: call.name, action: { kind: 'face', id: FACES.some(item => item.id === argumentsValue.id) ? argumentsValue.id : '' } }
  if (call.name !== 'change_pose')
    return undefined
  return { name: call.name, action: { kind: 'pose', id: POSES.some(item => item.id === argumentsValue.id) ? argumentsValue.id : '' } }
}

export function characterActionToToolCall(action: CharacterAction) {
  if (action.kind === 'outfit')
    return { name: 'change_outfit' as const, arguments: { id: action.id, library: action.library } }
  const name = action.kind === 'character'
    ? 'change_character'
    : action.kind === 'face'
      ? 'change_face'
      : 'change_pose'
  return { name, arguments: { id: action.id } }
}

export function useAvatarToolCalls(apply: (action: CharacterAction) => boolean, maxEntries = 30) {
  const audit = shallowRef<AvatarToolAuditEntry[]>([])
  let sequence = 0

  function record(source: AvatarToolSource, name: AvatarToolAuditEntry['name'], status: AvatarToolAuditEntry['status'], code: AvatarToolAuditEntry['code']) {
    audit.value = [{ id: ++sequence, at: Date.now(), source, name, status, code }, ...audit.value]
      .slice(0, Math.max(1, Math.min(100, maxEntries)))
  }

  function execute(value: unknown, source: AvatarToolSource = 'assistant-tool'): AvatarToolResult {
    const parsed = parseToolCall(value)
    if (!parsed) {
      record(source, 'rejected', 'rejected', 'invalid_call')
      return { ok: false, code: 'invalid_call' }
    }
    if (!parsed.action.id || !apply(parsed.action)) {
      record(source, parsed.name, 'rejected', 'asset_not_found')
      return { ok: false, name: parsed.name, kind: parsed.action.kind, code: 'asset_not_found' }
    }
    record(source, parsed.name, 'applied', 'ok')
    return { ok: true, name: parsed.name, kind: parsed.action.kind, code: 'ok' }
  }

  function clearAudit() {
    audit.value = []
  }

  return { audit: readonly(audit), execute, clearAudit }
}
