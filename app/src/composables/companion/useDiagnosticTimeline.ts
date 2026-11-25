import { readonly, shallowRef } from 'vue'

export interface DiagnosticTimelineEntry {
  id: number
  at: number
  type: string
  code?: string
  value?: number
}

function safeCode(value: string) {
  return /^[\w.-]{1,64}$/.test(value) ? value : 'unknown'
}

export function useDiagnosticTimeline(maxEntries = 30) {
  const entries = shallowRef<DiagnosticTimelineEntry[]>([])
  let sequence = 0

  function add(type: string, detail: { code?: string, value?: number } = {}, at = Date.now()) {
    const entry: DiagnosticTimelineEntry = {
      id: ++sequence,
      at: Number.isFinite(at) ? at : Date.now(),
      type: safeCode(type),
      ...(detail.code ? { code: safeCode(detail.code) } : {}),
      ...(Number.isFinite(detail.value) ? { value: Math.max(0, Math.min(1_000_000, Math.floor(detail.value!))) } : {}),
    }
    entries.value = [entry, ...entries.value].slice(0, Math.max(1, Math.min(100, maxEntries)))
    return entry
  }

  function clear() {
    entries.value = []
  }

  return { entries: readonly(entries), add, clear }
}
