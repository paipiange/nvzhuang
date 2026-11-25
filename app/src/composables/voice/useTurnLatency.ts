import { readonly, shallowRef } from 'vue'

export type DuplexLatencyEvent
  = | { type: 'connect.started' | 'session.ready', at: number }
    | { type: 'turn.started' | 'transcript.first' | 'audio.first' | 'turn.completed', at: number, turnId: string }
    | { type: 'session.stopped', at: number }

export interface TurnLatencySnapshot {
  connectMs: number | null
  firstTranscriptMs: number | null
  firstAudioMs: number | null
  turnCompleteMs: number | null
}

const emptySnapshot = (): TurnLatencySnapshot => ({ connectMs: null, firstTranscriptMs: null, firstAudioMs: null, turnCompleteMs: null })

export function useTurnLatency() {
  const metrics = shallowRef<TurnLatencySnapshot>(emptySnapshot())
  let connectStartedAt = 0
  let turnStartedAt = 0
  let currentTurn = ''

  function elapsed(start: number, end: number) {
    return Math.max(0, Math.min(300_000, Math.round(end - start)))
  }

  function note(event: DuplexLatencyEvent) {
    if (event.type === 'connect.started') {
      connectStartedAt = event.at
      metrics.value = emptySnapshot()
      return
    }
    if (event.type === 'session.ready') {
      if (connectStartedAt)
        metrics.value = { ...metrics.value, connectMs: elapsed(connectStartedAt, event.at) }
      return
    }
    if (event.type === 'session.stopped') {
      connectStartedAt = turnStartedAt = 0
      currentTurn = ''
      return
    }
    if (event.type === 'turn.started') {
      currentTurn = event.turnId
      turnStartedAt = event.at
      metrics.value = { ...metrics.value, firstTranscriptMs: null, firstAudioMs: null, turnCompleteMs: null }
      return
    }
    if (!('turnId' in event) || !turnStartedAt || event.turnId !== currentTurn)
      return
    if (event.type === 'transcript.first' && metrics.value.firstTranscriptMs === null)
      metrics.value = { ...metrics.value, firstTranscriptMs: elapsed(turnStartedAt, event.at) }
    else if (event.type === 'audio.first' && metrics.value.firstAudioMs === null)
      metrics.value = { ...metrics.value, firstAudioMs: elapsed(turnStartedAt, event.at) }
    else if (event.type === 'turn.completed')
      metrics.value = { ...metrics.value, turnCompleteMs: elapsed(turnStartedAt, event.at) }
  }

  function reset() {
    connectStartedAt = turnStartedAt = 0
    currentTurn = ''
    metrics.value = emptySnapshot()
  }

  return { metrics: readonly(metrics), note, reset }
}
