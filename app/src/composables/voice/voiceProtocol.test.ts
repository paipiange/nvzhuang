import { describe, expect, it } from 'vitest'
import { FRAME_BYTES, INPUT_RATE, MAX_CONTROL_MESSAGE_CHARS, MAX_PLAYER_SECONDS, MAX_SOCKET_BUFFER, MAX_VOICE_TEXT_CHARS, OUTPUT_RATE, readVoiceEvent, validateVoiceEndpoint } from './voiceProtocol'

describe('voiceProtocol', () => {
  it('defines 20 ms mono PCM16 input frames and bounded queues', () => {
    expect(INPUT_RATE).toBe(16000)
    expect(OUTPUT_RATE).toBe(24000)
    expect(FRAME_BYTES).toBe(INPUT_RATE * 0.02 * 2)
    expect(FRAME_BYTES).toBe(640)
    expect(MAX_SOCKET_BUFFER).toBe(128 * 1024)
    expect(MAX_PLAYER_SECONDS).toBe(8)
    expect(MAX_CONTROL_MESSAGE_CHARS).toBe(64 * 1024)
    expect(MAX_VOICE_TEXT_CHARS).toBe(20 * 1024)
  })

  it('reads server event metadata without dropping optional fields', () => {
    const event = {
      type: 'assistant.audio.start',
      turn_id: 'turn-1',
      streaming: true,
      codec: 'pcm_s16le',
      input_rate: 16000,
      output_rate: 24000,
      sample_rate: 24000,
      channels: 1,
      text: '你好',
    }
    expect(readVoiceEvent(JSON.stringify(event))).toEqual(event)
    expect(readVoiceEvent('{"type":"future.event"}')).toEqual({ type: 'future.event' })
  })

  it.each(['null', '[]', '123', '"event"', '{}', '{"type":false}'])('rejects non-event payload %s', (payload) => {
    expect(() => readVoiceEvent(payload)).toThrow('invalid_audio_frame')
  })

  it.each(['turn_id', 'text', 'code', 'message', 'codec'])('rejects a non-string %s at the wire boundary', (field) => {
    expect(() => readVoiceEvent(JSON.stringify({ type: 'error', [field]: 1 }))).toThrow('invalid_audio_frame')
    expect(() => readVoiceEvent(JSON.stringify({ type: 'error', [field]: null }))).toThrow('invalid_audio_frame')
  })

  it.each(['input_rate', 'output_rate', 'sample_rate', 'channels'])('rejects nonnumeric or nonfinite %s', (field) => {
    expect(() => readVoiceEvent(JSON.stringify({ type: 'session.ready', [field]: '16000' }))).toThrow('invalid_audio_frame')
    expect(() => readVoiceEvent(`{"type":"session.ready","${field}":1e999}`)).toThrow('invalid_audio_frame')
  })

  it('bounds control frames, identifiers, text and boolean metadata', () => {
    expect(() => readVoiceEvent('x'.repeat(MAX_CONTROL_MESSAGE_CHARS + 1))).toThrow('invalid_audio_frame')
    expect(() => readVoiceEvent(JSON.stringify({ type: 'asr.final', text: 'x'.repeat(MAX_VOICE_TEXT_CHARS + 1) }))).toThrow('invalid_audio_frame')
    expect(() => readVoiceEvent(JSON.stringify({ type: 'turn.end', turn_id: 'x'.repeat(65) }))).toThrow('invalid_audio_frame')
    expect(() => readVoiceEvent(JSON.stringify({ type: 'session.ready', streaming: 'true' }))).toThrow('invalid_audio_frame')
    expect(() => readVoiceEvent(JSON.stringify({ type: '' }))).toThrow('invalid_audio_frame')
  })

  it('rejects malformed JSON rather than treating it as an event', () => {
    expect(() => readVoiceEvent('{')).toThrow()
  })

  it('normalizes malformed endpoint parsing to a stable error code', () => {
    expect(() => validateVoiceEndpoint('not a websocket URL')).toThrow('invalid_voice_endpoint')
  })
})
