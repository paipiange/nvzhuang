import { ref } from 'vue'
import { supportsDuplexCapture, usePcmCapture } from './usePcmCapture'
import type { CaptureOptions } from './usePcmCapture'
import { useStreamingPlayer } from './useStreamingPlayer'
import type { DuplexLatencyEvent } from './useTurnLatency'
import { INPUT_RATE, MAX_SOCKET_BUFFER, MAX_VOICE_TEXT_CHARS, OUTPUT_RATE, readVoiceEvent, validateVoiceEndpoint } from './voiceProtocol'
import type { DuplexState, VoiceEvent } from './voiceProtocol'

const errorMessages: Record<string, string> = {
  duplex_not_supported: '当前设备不支持免提通话，请使用按轮模式。',
  microphone_denied: '麦克风权限被拒绝或已撤销，请在浏览器和系统设置中允许麦克风。',
  audio_backpressure: '网络或播放队列持续拥塞，通话已停止，请检查网络后重新连接。',
  seeduplex_unavailable: 'SeedDuplex 连接不可用，请检查当前设备配置或后端环境中的 Key、权限与网络。',
  seeduplex_timeout: 'SeedDuplex 响应超时，请重新开始通话。',
  invalid_audio_frame: '语音数据格式无效，通话已停止。',
  invalid_voice_endpoint: '语音后端只允许可信同源 HTTPS 或本机回环地址。Android 可通过 USB 端口转发连接电脑后端。',
  voice_not_configured: '当前角色尚未配置服务端音色，请完成该角色的音色映射后再开始通话。',
  unsupported_character: '当前引擎不支持此角色身份，请选择受支持角色或检查外部引擎配置。',
  seeduplex_error: 'SeedDuplex 连接中断，请检查网络后重新开始通话。',
  seeduplex_asr: '未能识别本轮语音，请缩短内容、靠近麦克风后重试。',
  seeduplex_audio: '语音回复格式或长度异常，通话已停止。',
  seeduplex_backpressure: 'SeedDuplex 上游持续拥塞，通话已停止，请稍后重试。',
  seeduplex_text_limit: '本轮识别或回复文本过长，通话已停止。',
  audio_too_large: '本轮说话时间过长，通话已停止，请缩短后重试。',
  session_audio_limit: '本次通话累计音频已达到安全上限，请重新开始通话。',
  output_device_not_supported: '当前浏览器不支持选择扬声器，请使用系统默认输出设备。',
}

interface DuplexStartOptions extends CaptureOptions { outputDeviceId?: string }

export function useDuplexSession(onTranscript: (text: string) => void = () => {}, onAudioLevel: (rms: number) => void = () => {}, onTurn: (transcript: string, answer: string) => void = () => {}, onLatency: (event: DuplexLatencyEvent) => void = () => {}) {
  const state = ref<DuplexState>('idle')
  const active = ref(false)
  const error = ref('')
  const errorCode = ref('')
  const transcript = ref('')
  const answer = ref('')
  const rms = ref(0)
  const peak = ref(0)
  const congested = ref(false)
  const muted = ref(false)
  let epoch = 0
  let socket: WebSocket | undefined
  let ready = false
  let requestedProfile: Record<string, string> = {}
  let turn = ''
  let audioTurn = ''
  let lastCancelled = ''
  let serverEnded = ''
  let playbackDrained = ''
  let hasAudio = false
  let activity = false
  let voicedFrames = 0
  let quietFrames = 0
  let blockedAt = 0
  let timeout: ReturnType<typeof setTimeout> | undefined
  const retired = new Set<string>()
  const reported = new Set<string>()
  const capture = usePcmCapture()
  const player = useStreamingPlayer((id) => {
    if (active.value && !retired.has(id)) {
      send({ type: 'playback.complete', turn_id: id })
      playbackDrained = id
      finishTurn(id)
      state.value = 'listening'
    }
  }, onAudioLevel, code => fail(code))
  function send(event: Record<string, unknown>) {
    if (ready && socket?.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify(event))
  }
  function retire(id: string) {
    if (!id)
      return
    retired.add(id)
    if (retired.size > 128)
      retired.delete(retired.values().next().value!)
  }
  function finishTurn(id: string) {
    if (serverEnded === id && (!hasAudio || playbackDrained === id))
      retire(id)
  }
  function appendText(current: string, delta = '') {
    if (current.length + delta.length > MAX_VOICE_TEXT_CHARS)
      throw new Error('invalid_audio_frame')
    return current + delta
  }
  function stop() {
    epoch++
    error.value = errorCode.value = ''
    if (timeout)
      clearTimeout(timeout)
    timeout = undefined
    send({ type: 'session.stop' })
    ready = false
    const oldSocket = socket
    socket = undefined
    if (oldSocket) {
      oldSocket.onopen = oldSocket.onmessage = oldSocket.onerror = oldSocket.onclose = null
      oldSocket.close(1000, 'session stopped')
    }
    capture.stop()
    player.dispose()
    turn = audioTurn = lastCancelled = serverEnded = playbackDrained = ''
    hasAudio = false
    activity = false
    voicedFrames = quietFrames = 0
    blockedAt = 0
    congested.value = false
    muted.value = false
    active.value = false
    state.value = 'idle'
    rms.value = peak.value = 0
    retired.clear()
    reported.clear()
    onLatency({ type: 'session.stopped', at: Date.now() })
  }
  function fail(code: string) {
    stop()
    errorCode.value = code
    error.value = errorMessages[code] || errorMessages.seeduplex_unavailable
  }
  function normalizeError(cause: unknown, fallback = 'seeduplex_unavailable') {
    const code = cause instanceof Error ? cause.message : ''
    return code in errorMessages ? code : fallback
  }
  function interrupt() {
    const id = audioTurn || turn
    player.clear()
    audioTurn = ''
    if (id && id !== lastCancelled) {
      lastCancelled = id
      retire(id)
      send({ type: 'assistant.cancel', turn_id: id })
    }
    if (active.value)
      state.value = 'listening'
  }
  function setMuted(value: boolean) {
    if (!active.value)
      return false
    if (muted.value === value)
      return true
    muted.value = value
    voicedFrames = quietFrames = 0
    rms.value = peak.value = 0
    if (value && activity) {
      activity = false
      send({ type: 'input.activity', active: false })
    }
    return true
  }
  function toggleMuted() {
    return setMuted(!muted.value)
  }
  function reset() {
    if (!ready)
      return
    retire(turn)
    player.clear()
    audioTurn = turn = serverEnded = playbackDrained = ''
    hasAudio = false
    send({ type: 'session.reset' })
    ready = false
    state.value = 'connecting'
    transcript.value = answer.value = ''
    reported.clear()
    const generation = epoch
    timeout = setTimeout(() => {
      if (generation === epoch)
        fail('seeduplex_timeout')
    }, 15000)
  }
  function handle(event: VoiceEvent) {
    if (event.type === 'session.ready') {
      if (requestedProfile.character_id === 'linxi' || event.character_id || event.persona_id || event.voice_id) {
        if (['character_id', 'persona_id', 'voice_id'].some(key => requestedProfile[key] && event[key as keyof VoiceEvent] !== requestedProfile[key])) {
          fail('unsupported_character')
          return
        }
      }
      if (event.streaming !== true || event.input_rate !== INPUT_RATE || event.output_rate !== OUTPUT_RATE) {
        fail('duplex_not_supported')
        return
      }
      ready = true
      if (timeout)
        clearTimeout(timeout)
      timeout = undefined
      if (state.value === 'connecting')
        state.value = 'listening'
      onLatency({ type: 'session.ready', at: Date.now() })
      return
    }
    if (event.type === 'error') {
      if (event.turn_id && retired.has(event.turn_id))
        return
      const code = event.code && event.code in errorMessages ? event.code : 'seeduplex_unavailable'
      if (code === 'seeduplex_timeout') {
        interrupt()
        errorCode.value = code
        error.value = errorMessages[code]
      }
      else { fail(code) }
      return
    }
    if (!ready)
      return
    const id = event.turn_id || ''
    if (event.type === 'input.speech.started') {
      if (id && retired.has(id))
        return
      if (turn && turn !== id)
        retire(turn)
      player.clear()
      audioTurn = ''
      turn = id
      serverEnded = playbackDrained = ''
      hasAudio = false
      transcript.value = answer.value = ''
      state.value = 'speaking'
      if (id)
        onLatency({ type: 'turn.started', at: Date.now(), turnId: id })
      return
    }
    if (!id || retired.has(id))
      return
    if (!turn) {
      turn = id
      onLatency({ type: 'turn.started', at: Date.now(), turnId: id })
    }
    if (id !== turn) {
      // A new model turn can start after the preceding completed turn.
      if (event.type !== 'assistant.audio.start' && event.type !== 'asr.delta' && event.type !== 'asr.final')
        return
      retire(turn)
      turn = id
      serverEnded = playbackDrained = ''
      hasAudio = false
      onLatency({ type: 'turn.started', at: Date.now(), turnId: id })
    }
    switch (event.type) {
      case 'input.speech.stopped':
        state.value = 'thinking'
        break
      case 'asr.delta':
        transcript.value = appendText(transcript.value, event.text)
        onLatency({ type: 'transcript.first', at: Date.now(), turnId: id })
        break
      case 'asr.final':
        transcript.value = event.text || ''
        onLatency({ type: 'transcript.first', at: Date.now(), turnId: id })
        onTranscript(transcript.value)
        break
      case 'assistant.text.delta':
        answer.value = appendText(answer.value, event.text)
        break
      case 'assistant.text.final':
        answer.value = event.text || answer.value
        break
      case 'assistant.audio.start':
        if (hasAudio)
          return
        hasAudio = true
        player.begin(id, event.sample_rate ?? event.output_rate ?? OUTPUT_RATE, event.channels ?? 1)
        audioTurn = id
        break
      case 'assistant.audio.end':
        player.end(id)
        audioTurn = ''
        break
      case 'assistant.cancel':
        player.clear()
        retire(id)
        audioTurn = ''
        state.value = 'listening'
        break
      case 'turn.end':
        serverEnded = id
        onLatency({ type: 'turn.completed', at: Date.now(), turnId: id })
        if (!reported.has(id) && (transcript.value || answer.value)) {
          reported.add(id)
          onTurn(transcript.value, answer.value)
        }
        finishTurn(id)
        if (state.value !== 'playing')
          state.value = 'listening'
        break
    }
  }
  async function start(url: string, character: Record<string, string> = {}, apiKey = '', captureOptions: DuplexStartOptions = {}) {
    stop()
    error.value = errorCode.value = transcript.value = answer.value = ''
    requestedProfile = { ...character }
    if (!supportsDuplexCapture()) {
      fail('duplex_not_supported')
      return
    }
    let endpoint: string
    try {
      endpoint = validateVoiceEndpoint(url)
      if (apiKey.length > 2048 || (apiKey && !/^[\x21-\x7E]+$/.test(apiKey)))
        throw new Error('seeduplex_unavailable')
    }
    catch (cause) {
      fail(cause instanceof Error ? cause.message : 'invalid_voice_endpoint')
      return
    }
    const generation = epoch
    const isCurrent = () => generation === epoch
    active.value = true
    state.value = 'connecting'
    onLatency({ type: 'connect.started', at: Date.now() })
    try {
      await player.setOutputDevice(captureOptions.outputDeviceId || '')
      await player.prepare()
      if (!isCurrent())
        return
      const started = await capture.start((frame) => {
        if (muted.value) {
          rms.value = peak.value = 0
          return
        }
        rms.value = frame.rms
        peak.value = frame.peak
        if (!ready || socket?.readyState !== WebSocket.OPEN)
          return
        if (socket.bufferedAmount > MAX_SOCKET_BUFFER) {
          congested.value = true
          if (!blockedAt)
            blockedAt = Date.now()
          else if (Date.now() - blockedAt > 3000)
            fail('audio_backpressure')
          return
        }
        congested.value = false
        blockedAt = 0
        socket.send(frame.pcm)
        if (frame.rms > 0.025) {
          voicedFrames++
          quietFrames = 0
          if (!activity && voicedFrames >= 3) {
            activity = true
            if (audioTurn || state.value === 'playing' || state.value === 'thinking')
              interrupt()
            send({ type: 'input.activity', active: true })
          }
        }
        else {
          voicedFrames = 0
          if (activity && ++quietFrames >= 15) {
            activity = false
            send({ type: 'input.activity', active: false })
          }
        }
      }, () => fail('microphone_denied'), captureOptions)
      if (!started || !isCurrent())
        return
      const connection = new WebSocket(endpoint)
      socket = connection
      connection.binaryType = 'arraybuffer'
      timeout = setTimeout(() => {
        if (isCurrent())
          fail('seeduplex_timeout')
      }, 15000)
      connection.onopen = () => {
        if (isCurrent())
          connection.send(JSON.stringify({ ...character, type: 'session.start', provider: 'seeduplex', codec: 'pcm_s16le', input_rate: INPUT_RATE, streaming: true, client_vad: true, ...(apiKey ? { api_key: apiKey } : {}) }))
      }
      connection.onmessage = ({ data }: MessageEvent<unknown>) => {
        if (!isCurrent())
          return
        try {
          if (typeof data === 'string') {
            handle(readVoiceEvent(data))
          }
          else if (data instanceof ArrayBuffer && audioTurn && !retired.has(audioTurn)) {
            if (player.push(audioTurn, data)) {
              state.value = 'playing'
              onLatency({ type: 'audio.first', at: Date.now(), turnId: audioTurn })
            }
          }
        }
        catch (cause) { fail(normalizeError(cause, 'invalid_audio_frame')) }
      }
      connection.onerror = connection.onclose = () => {
        if (isCurrent())
          fail('seeduplex_unavailable')
      }
    }
    catch (cause) {
      if (isCurrent()) {
        const denied = typeof cause === 'object' && cause !== null && 'name' in cause && (cause.name === 'NotAllowedError' || cause.name === 'SecurityError')
        fail(denied ? 'microphone_denied' : normalizeError(cause))
      }
    }
  }
  return { state, active, error, errorCode, transcript, answer, rms, peak, congested, muted, start, stop, interrupt, reset, setMuted, toggleMuted }
}
