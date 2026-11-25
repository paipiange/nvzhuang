export interface DiagnosticReportInput {
  provider: 'local' | 'seeduplex' | 'open-llm-vtuber'
  characterId: string
  online: boolean
  reconnectStatus: string
  reconnectAttempt: number
  voiceState: string
  duplexState: string
  duplexErrorCode: string
  quality: {
    grade: string
    durationSeconds: number
    reconnects: number
    congestionEvents: number
  }
  latency: {
    connectMs: number | null
    firstTranscriptMs: number | null
    firstAudioMs: number | null
    turnCompleteMs: number | null
  }
  readiness: Array<{ key: string, ok: boolean, blocking: boolean }>
  audio: {
    inputAvailable: boolean
    outputAvailable: boolean
    echoCancellation?: boolean
    noiseSuppression?: boolean
    autoGainControl?: boolean
  }
  localData: {
    transcripts: number
    presets: number
    portraitQueue: number
    portraitHistory: number
  }
  events: Array<{ at: number, type: string, code?: string, value?: number }>
  toolCalls: Array<{ at: number, source: string, name: string, status: string, code: string }>
}

function safeCode(value: string, fallback: string) {
  return /^[\w.-]{1,64}$/.test(value) ? value : fallback
}

function count(value: number, max = 1_000_000) {
  return Number.isFinite(value) ? Math.min(max, Math.max(0, Math.floor(value))) : 0
}

export function createDiagnosticReport(input: DiagnosticReportInput, now = Date.now()) {
  const provider = ['local', 'seeduplex', 'open-llm-vtuber'].includes(input.provider) ? input.provider : 'local'
  const gradeLabels: Record<string, string> = { 良好: 'good', 一般: 'fair', 较差: 'poor' }
  return {
    version: 1,
    generatedAt: new Date(now).toISOString(),
    provider,
    characterId: safeCode(input.characterId, 'unknown'),
    connection: {
      online: !!input.online,
      reconnectStatus: safeCode(input.reconnectStatus, 'unknown'),
      reconnectAttempt: count(input.reconnectAttempt, 100),
      voiceState: safeCode(input.voiceState, 'unknown'),
      duplexState: safeCode(input.duplexState, 'unknown'),
      duplexErrorCode: input.duplexErrorCode ? safeCode(input.duplexErrorCode, 'unknown_error') : '',
    },
    quality: {
      grade: safeCode(gradeLabels[input.quality.grade] || input.quality.grade, 'unknown'),
      durationSeconds: count(input.quality.durationSeconds, 86_400),
      reconnects: count(input.quality.reconnects, 10_000),
      congestionEvents: count(input.quality.congestionEvents, 10_000),
    },
    latency: {
      connectMs: input.latency.connectMs === null ? null : count(input.latency.connectMs, 300_000),
      firstTranscriptMs: input.latency.firstTranscriptMs === null ? null : count(input.latency.firstTranscriptMs, 300_000),
      firstAudioMs: input.latency.firstAudioMs === null ? null : count(input.latency.firstAudioMs, 300_000),
      turnCompleteMs: input.latency.turnCompleteMs === null ? null : count(input.latency.turnCompleteMs, 300_000),
    },
    readiness: input.readiness.slice(0, 20).map(item => ({
      key: safeCode(item.key, 'unknown'),
      ok: !!item.ok,
      blocking: !!item.blocking,
    })),
    audio: {
      inputAvailable: !!input.audio.inputAvailable,
      outputAvailable: !!input.audio.outputAvailable,
      echoCancellation: input.audio.echoCancellation ?? null,
      noiseSuppression: input.audio.noiseSuppression ?? null,
      autoGainControl: input.audio.autoGainControl ?? null,
    },
    localData: {
      transcripts: count(input.localData.transcripts, 50),
      presets: count(input.localData.presets, 10),
      portraitQueue: count(input.localData.portraitQueue, 3),
      portraitHistory: count(input.localData.portraitHistory, 10),
    },
    events: input.events.slice(0, 30).map(event => ({
      at: Number.isFinite(event.at) ? event.at : 0,
      type: safeCode(event.type, 'unknown'),
      ...(event.code ? { code: safeCode(event.code, 'unknown') } : {}),
      ...(Number.isFinite(event.value) ? { value: count(event.value!, 1_000_000) } : {}),
    })),
    toolCalls: input.toolCalls.slice(0, 30).map(call => ({
      at: Number.isFinite(call.at) ? call.at : 0,
      source: safeCode(call.source, 'unknown'),
      name: safeCode(call.name, 'unknown'),
      status: safeCode(call.status, 'unknown'),
      code: safeCode(call.code, 'unknown'),
    })),
  }
}
