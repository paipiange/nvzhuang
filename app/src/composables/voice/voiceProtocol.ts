export type DuplexState = 'idle' | 'connecting' | 'listening' | 'speaking' | 'thinking' | 'playing'
export type VoiceErrorCode = 'duplex_not_supported' | 'microphone_denied' | 'audio_backpressure' | 'seeduplex_unavailable' | 'seeduplex_timeout' | 'invalid_audio_frame' | 'invalid_voice_endpoint' | 'voice_not_configured' | 'unsupported_character' | 'seeduplex_error' | 'seeduplex_asr' | 'seeduplex_audio' | 'seeduplex_backpressure' | 'seeduplex_text_limit' | 'audio_too_large' | 'session_audio_limit'
export interface VoiceEvent {
  type: string
  turn_id?: string
  text?: string
  code?: string
  message?: string
  streaming?: boolean
  codec?: string
  input_rate?: number
  output_rate?: number
  sample_rate?: number
  channels?: number
  character_id?: string
  persona_id?: string
  voice_id?: string
}
export const INPUT_RATE = 16000
export const OUTPUT_RATE = 24000
export const FRAME_BYTES = 640
export const MAX_SOCKET_BUFFER = 128 * 1024
export const MAX_PLAYER_SECONDS = 8
export const MAX_CONTROL_MESSAGE_CHARS = 64 * 1024
export const MAX_VOICE_TEXT_CHARS = 20 * 1024

const stringLimits: Record<string, number> = {
  type: 64,
  turn_id: 64,
  text: MAX_VOICE_TEXT_CHARS,
  code: 64,
  message: 512,
  codec: 32,
  character_id: 64,
  persona_id: 64,
  voice_id: 64,
}

export function validateVoiceEndpoint(value: string) {
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    throw new Error('invalid_voice_endpoint')
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const sameOrigin = url.origin.replace(/^ws/, 'http') === origin
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || !(loopback || (sameOrigin && url.protocol === 'wss:'))) {
    throw new Error('invalid_voice_endpoint')
  }
  return url.href
}

export function readVoiceEvent(data: string): VoiceEvent {
  if (!data || data.length > MAX_CONTROL_MESSAGE_CHARS)
    throw new Error('invalid_audio_frame')
  const event: unknown = JSON.parse(data)
  if (!event || typeof event !== 'object' || Array.isArray(event) || !('type' in event) || typeof event.type !== 'string')
    throw new Error('invalid_audio_frame')
  const value = event as Record<string, unknown>
  for (const [key, limit] of Object.entries(stringLimits)) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > limit))
      throw new Error('invalid_audio_frame')
  }
  if (value.streaming !== undefined && typeof value.streaming !== 'boolean')
    throw new Error('invalid_audio_frame')
  for (const key of ['input_rate', 'output_rate', 'sample_rate', 'channels']) {
    if (value[key] !== undefined && (typeof value[key] !== 'number' || !Number.isFinite(value[key])))
      throw new Error('invalid_audio_frame')
  }
  if (!value.type)
    throw new Error('invalid_audio_frame')
  return value as unknown as VoiceEvent
}
