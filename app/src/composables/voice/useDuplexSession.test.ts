import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDuplexSession } from './useDuplexSession'
import { supportsDuplexCapture, usePcmCapture } from './usePcmCapture'
import { useStreamingPlayer } from './useStreamingPlayer'
import { FRAME_BYTES, MAX_SOCKET_BUFFER, MAX_VOICE_TEXT_CHARS, OUTPUT_RATE } from './voiceProtocol'
import type { CaptureFrame } from './usePcmCapture'

// Exercise the real composables; only browser-owned audio, media and socket APIs are replaced.
class AudioNodeMock {
  connect = vi.fn((destination: object) => destination)
  disconnect = vi.fn()
}

class BufferMock {
  readonly data: Float32Array
  readonly duration: number
  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {
    this.data = new Float32Array(length)
    this.duration = length / sampleRate
  }

  getChannelData(channel: number) {
    if (channel !== 0)
      throw new DOMException('Invalid channel', 'IndexSizeError')
    return this.data
  }
}

class BufferSourceMock extends AudioNodeMock {
  buffer: BufferMock | null = null
  onended: ((event: Event) => void) | null = null
  start = vi.fn((_when = 0) => {})
  stop = vi.fn()
  finish() {
    this.onended?.(new Event('ended'))
  }
}

class ContextMock {
  static instances: ContextMock[] = []
  state: AudioContextState = 'suspended'
  currentTime = 1
  destination = new AudioNodeMock()
  mediaSource = new AudioNodeMock()
  gainNode = Object.assign(new AudioNodeMock(), { gain: { value: 1 } })
  sources: BufferSourceMock[] = []
  buffers: BufferMock[] = []
  worklet = { addModule: vi.fn(async (_url: string) => {}) }
  get audioWorklet() { return this.worklet }
  resume = vi.fn(async () => { this.state = 'running' })
  close = vi.fn(async () => { this.state = 'closed' })
  setSinkId = vi.fn(async (_sinkId: string) => {})
  createMediaStreamSource = vi.fn((_stream: MediaStream) => this.mediaSource)
  createGain = vi.fn(() => this.gainNode)
  createBuffer = vi.fn((channels: number, length: number, sampleRate: number) => {
    const buffer = new BufferMock(channels, length, sampleRate)
    this.buffers.push(buffer)
    return buffer
  })

  createBufferSource = vi.fn(() => {
    const source = new BufferSourceMock()
    this.sources.push(source)
    return source
  })

  constructor() {
    ContextMock.instances.push(this)
  }
}

class WorkletNodeMock extends AudioNodeMock {
  static instances: WorkletNodeMock[] = []
  port = {
    onmessage: null as ((event: MessageEvent<CaptureFrame>) => void) | null,
    close: vi.fn(),
  }

  constructor(readonly context: ContextMock, readonly name: string) {
    super()
    WorkletNodeMock.instances.push(this)
  }

  emit(data: CaptureFrame) {
    this.port.onmessage?.(new MessageEvent('message', { data }))
  }
}

class TrackMock {
  readyState: MediaStreamTrackState = 'live'
  onended: ((event: Event) => void) | null = null
  label = 'USB 麦克风'
  getSettings = vi.fn(() => ({ echoCancellation: true, noiseSuppression: true, autoGainControl: false }))
  stop = vi.fn(() => { this.readyState = 'ended' })
  end() {
    this.readyState = 'ended'
    this.onended?.(new Event('ended'))
  }
}

class SocketMock {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: SocketMock[] = []
  readyState = SocketMock.CONNECTING
  binaryType: BinaryType = 'blob'
  bufferedAmount = 0
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  sent: (string | ArrayBuffer)[] = []
  send = vi.fn((data: string | ArrayBuffer) => {
    if (this.readyState !== SocketMock.OPEN)
      throw new DOMException('WebSocket is not open', 'InvalidStateError')
    this.sent.push(data)
  })

  close = vi.fn((_code?: number, _reason?: string) => {
    this.readyState = SocketMock.CLOSED
  })

  constructor(readonly url: string) {
    SocketMock.instances.push(this)
  }

  open() {
    this.readyState = SocketMock.OPEN
    this.onopen?.(new Event('open'))
  }

  receive(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: typeof data === 'object' && !(data instanceof ArrayBuffer) ? JSON.stringify(data) : data }))
  }

  events() {
    return this.sent.filter((value): value is string => typeof value === 'string').map(value => JSON.parse(value) as Record<string, unknown>)
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function frame(rms = 0): CaptureFrame {
  return { pcm: new ArrayBuffer(FRAME_BYTES), rms, peak: rms }
}

function pcm(samples: number[]) {
  const buffer = new ArrayBuffer(samples.length * 2)
  const view = new DataView(buffer)
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true))
  return buffer
}

let track: TrackMock
let media: MediaStream
let getUserMedia: ReturnType<typeof vi.fn<() => Promise<MediaStream>>>
const cleanups: (() => void)[] = []
const mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')

function acquireMedia() {
  track = new TrackMock()
  const tracks = [track]
  media = { getTracks: () => [...tracks], getAudioTracks: () => [...tracks] } as unknown as MediaStream
  return media
}

beforeEach(() => {
  ContextMock.instances = []
  WorkletNodeMock.instances = []
  SocketMock.instances = []
  acquireMedia()
  getUserMedia = vi.fn(async () => acquireMedia())
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  vi.stubGlobal('AudioContext', ContextMock)
  vi.stubGlobal('AudioWorkletNode', WorkletNodeMock)
  vi.stubGlobal('WebSocket', SocketMock)
})

afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
  vi.useRealTimers()
  vi.unstubAllGlobals()
  if (mediaDevicesDescriptor)
    Object.defineProperty(navigator, 'mediaDevices', mediaDevicesDescriptor)
  else
    Reflect.deleteProperty(navigator, 'mediaDevices')
})

async function connectSession() {
  const transcript = vi.fn()
  const level = vi.fn()
  const turn = vi.fn()
  const session = useDuplexSession(transcript, level, turn)
  cleanups.push(session.stop)
  await session.start('ws://localhost/voice', { character_id: 'demo' })
  const socket = SocketMock.instances[0]
  socket.open()
  socket.receive({ type: 'session.ready', streaming: true, input_rate: 16000, output_rate: 24000 })
  return { session, socket, transcript, level, turn, capture: WorkletNodeMock.instances[0], player: ContextMock.instances[0] }
}

describe('usePcmCapture with browser media and AudioWorklet interfaces', () => {
  it('requests mono echo-cancelled audio and forwards consecutive 640-byte frames without VAD gating', async () => {
    const capture = usePcmCapture()
    cleanups.push(capture.stop)
    const onFrame = vi.fn()
    const onEnded = vi.fn()
    expect(supportsDuplexCapture()).toBe(true)
    expect(await capture.start(onFrame, onEnded)).toBe(true)
    const context = ContextMock.instances[0]
    const worklet = WorkletNodeMock.instances[0]
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    expect(context.resume).toHaveBeenCalledOnce()
    expect(context.audioWorklet.addModule).toHaveBeenCalledWith(expect.stringContaining('pcm-capture.worklet.js'))
    expect(worklet.name).toBe('pcm-capture')
    expect(context.mediaSource.connect).toHaveBeenCalledWith(worklet)
    expect(worklet.connect).toHaveBeenCalledWith(context.gainNode)
    expect(context.gainNode.connect).toHaveBeenCalledWith(context.destination)
    expect(context.gainNode.gain.value).toBe(0)
    const frames = Array.from({ length: 100 }, (_, index) => frame(index % 2 ? 0.4 : 0))
    frames.forEach(value => worklet.emit(value))
    expect(onFrame.mock.calls.map(([value]) => value)).toEqual(frames)
    track.end()
    expect(onEnded).toHaveBeenCalledOnce()
  })

  it('uses the selected input device and reports effective audio processing settings', async () => {
    const capture = usePcmCapture()
    cleanups.push(capture.stop)
    const onConfigured = vi.fn()
    await capture.start(vi.fn(), vi.fn(), { deviceId: 'usb-mic', onConfigured })
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        deviceId: { exact: 'usb-mic' },
      },
    })
    expect(onConfigured).toHaveBeenCalledWith({
      deviceLabel: 'USB 麦克风',
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
    })
  })

  it('ignores invalid worklet frames and disconnects every resource on idempotent stop', async () => {
    const capture = usePcmCapture()
    const onFrame = vi.fn()
    await capture.start(onFrame, vi.fn())
    const context = ContextMock.instances[0]
    const worklet = WorkletNodeMock.instances[0]
    const lateMessage = worklet.port.onmessage!
    worklet.emit({ ...frame(), pcm: new ArrayBuffer(638) })
    worklet.emit({ ...frame(), rms: Number.NaN })
    worklet.emit({ ...frame(), peak: Number.POSITIVE_INFINITY })
    expect(onFrame).not.toHaveBeenCalled()
    capture.stop()
    capture.stop()
    lateMessage(new MessageEvent('message', { data: frame() }))
    expect(onFrame).not.toHaveBeenCalled()
    expect(worklet.port.onmessage).toBeNull()
    expect(worklet.port.close).toHaveBeenCalledOnce()
    expect(worklet.disconnect).toHaveBeenCalledOnce()
    expect(context.mediaSource.disconnect).toHaveBeenCalledOnce()
    expect(context.gainNode.disconnect).toHaveBeenCalledOnce()
    expect(track.onended).toBeNull()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(context.close).toHaveBeenCalledOnce()
  })

  it('releases a permission result arriving after stop instead of reconnecting capture', async () => {
    const permission = deferred<MediaStream>()
    getUserMedia.mockReturnValue(permission.promise)
    const capture = usePcmCapture()
    const start = capture.start(vi.fn(), vi.fn())
    await Promise.resolve()
    expect(getUserMedia).toHaveBeenCalledOnce()
    capture.stop()
    permission.resolve(media)
    expect(await start).toBe(false)
    expect(track.stop).toHaveBeenCalledOnce()
    expect(ContextMock.instances[0].close).toHaveBeenCalledOnce()
    expect(WorkletNodeMock.instances).toHaveLength(0)
  })

  it('closes its context when microphone permission is rejected', async () => {
    getUserMedia.mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'))
    const capture = usePcmCapture()
    await expect(capture.start(vi.fn(), vi.fn())).rejects.toMatchObject({ name: 'NotAllowedError' })
    expect(ContextMock.instances[0].close).toHaveBeenCalledOnce()
    expect(WorkletNodeMock.instances).toHaveLength(0)
  })

  it('releases media when loading the worklet fails', async () => {
    const load = vi.spyOn(ContextMock.prototype, 'audioWorklet', 'get').mockReturnValue({ addModule: vi.fn().mockRejectedValue(new Error('worklet unavailable')) })
    const capture = usePcmCapture()
    try {
      await expect(capture.start(vi.fn(), vi.fn())).rejects.toThrow('worklet unavailable')
      expect(track.stop).toHaveBeenCalledOnce()
      expect(track.onended).toBeNull()
      expect(ContextMock.instances[0].close).toHaveBeenCalledOnce()
    }
    finally {
      load.mockRestore()
    }
  })

  it('reports unsupported devices before allocating microphone or audio resources', async () => {
    vi.stubGlobal('AudioWorkletNode', undefined)
    expect(supportsDuplexCapture()).toBe(false)
    await expect(usePcmCapture().start(vi.fn(), vi.fn())).rejects.toThrow('duplex_not_supported')
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(ContextMock.instances).toHaveLength(0)
  })
})

describe('useStreamingPlayer with scheduled AudioBufferSourceNodes', () => {
  it('applies a selected output device before playback', async () => {
    const player = useStreamingPlayer(vi.fn())
    cleanups.push(player.dispose)
    await player.setOutputDevice('speaker-a')
    await player.prepare()
    expect(ContextMock.instances[0].setSinkId).toHaveBeenCalledWith('speaker-a')
  })

  it('converts little-endian PCM16 and schedules chunks sequentially without waiting for full audio', async () => {
    const complete = vi.fn()
    const level = vi.fn()
    const player = useStreamingPlayer(complete, level)
    cleanups.push(player.dispose)
    await player.prepare()
    player.begin('one')
    expect(player.push('one', pcm([-32768, 0, 16384, 32767]))).toBe(true)
    const context = ContextMock.instances[0]
    expect(context.buffers[0].numberOfChannels).toBe(1)
    expect(context.buffers[0].sampleRate).toBe(OUTPUT_RATE)
    expect(Array.from(context.buffers[0].data)).toEqual([-1, 0, 0.5, 32767 / 32768])
    expect(context.sources[0].start).toHaveBeenCalledWith(1.08)
    const chunk = new ArrayBuffer(4800)
    expect(player.push('one', chunk)).toBe(true)
    expect(context.sources[1].start).toHaveBeenCalledWith(1.08 + 4 / OUTPUT_RATE)
    expect(level.mock.calls[1][0]).toBeCloseTo(Math.sqrt((1 + 0.25 + (32767 / 32768) ** 2) / 4))
    expect(complete).not.toHaveBeenCalled()
    player.end('one')
    context.sources[0].finish()
    expect(complete).not.toHaveBeenCalled()
    context.sources[1].finish()
    expect(complete).toHaveBeenCalledExactlyOnceWith('one')
    expect(level).toHaveBeenLastCalledWith(0)
  })

  it('cancels queued nodes and isolates cancelled or late turns and their completion callbacks', async () => {
    const complete = vi.fn()
    const player = useStreamingPlayer(complete)
    cleanups.push(player.dispose)
    await player.prepare()
    player.begin('old')
    player.push('old', new ArrayBuffer(4800))
    const oldSource = ContextMock.instances[0].sources[0]
    const lateEnded = oldSource.onended!
    player.end('old')
    player.clear()
    expect(oldSource.stop).toHaveBeenCalledOnce()
    expect(oldSource.disconnect).toHaveBeenCalledOnce()
    expect(oldSource.onended).toBeNull()
    expect(player.push('old', new ArrayBuffer(4800))).toBe(false)
    player.begin('new')
    player.push('new', new ArrayBuffer(4800))
    player.end('old')
    lateEnded(new Event('ended'))
    expect(complete).not.toHaveBeenCalled()
    player.end('new')
    ContextMock.instances[0].sources[1].finish()
    expect(complete).toHaveBeenCalledExactlyOnceWith('new')
    expect(player.push('new', new ArrayBuffer(4800))).toBe(false)
  })

  it('enforces queued playback duration and allows a fresh turn after clearing backpressure', async () => {
    const player = useStreamingPlayer(vi.fn())
    cleanups.push(player.dispose)
    await player.prepare()
    player.begin('full')
    for (let index = 0; index < 7; index++)
      expect(player.push('full', new ArrayBuffer(OUTPUT_RATE * 2))).toBe(true)
    expect(() => player.push('full', new ArrayBuffer(OUTPUT_RATE * 2))).toThrow('audio_backpressure')
    expect(ContextMock.instances[0].sources).toHaveLength(7)
    player.clear()
    player.begin('fresh')
    expect(player.push('fresh', new ArrayBuffer(4800))).toBe(true)
  })

  it('completes empty ended turns once and disposes and recreates audio contexts', async () => {
    const complete = vi.fn()
    const player = useStreamingPlayer(complete)
    cleanups.push(player.dispose)
    await player.prepare()
    player.begin('empty')
    player.end('other')
    expect(complete).not.toHaveBeenCalled()
    player.end('empty')
    player.end('empty')
    expect(complete).toHaveBeenCalledExactlyOnceWith('empty')
    player.begin('playing')
    player.push('playing', new ArrayBuffer(4800))
    player.dispose()
    player.dispose()
    expect(ContextMock.instances[0].sources[0].stop).toHaveBeenCalledOnce()
    expect(ContextMock.instances[0].close).toHaveBeenCalledOnce()
    await player.prepare()
    expect(ContextMock.instances).toHaveLength(2)
    expect(ContextMock.instances[1].state).toBe('running')
  })

  it('rejects unsupported formats and malformed binary data before scheduling', async () => {
    const player = useStreamingPlayer(vi.fn())
    cleanups.push(player.dispose)
    await player.prepare()
    expect(() => player.begin('rate', 16000)).toThrow('invalid_audio_frame')
    expect(() => player.begin('stereo', OUTPUT_RATE, 2)).toThrow('invalid_audio_frame')
    expect(() => player.begin('')).toThrow('invalid_audio_frame')
    player.begin('valid')
    for (const size of [0, 3, 256 * 1024 + 2])
      expect(() => player.push('valid', new ArrayBuffer(size))).toThrow('invalid_audio_frame')
    expect(ContextMock.instances[0].sources).toHaveLength(0)
  })
})

describe('useDuplexSession end-to-end orchestration', () => {
  it('emits timing events without transcript or audio contents', async () => {
    const latency = vi.fn()
    const session = useDuplexSession(vi.fn(), vi.fn(), vi.fn(), latency)
    cleanups.push(session.stop)
    await session.start('ws://localhost/voice', { character_id: 'demo' })
    const socket = SocketMock.instances[0]
    socket.open()
    socket.receive({ type: 'session.ready', streaming: true, input_rate: 16000, output_rate: 24000 })
    socket.receive({ type: 'input.speech.started', turn_id: 'timed' })
    socket.receive({ type: 'asr.delta', turn_id: 'timed', text: 'private' })
    socket.receive({ type: 'assistant.audio.start', turn_id: 'timed', sample_rate: OUTPUT_RATE, channels: 1 })
    socket.receive(new ArrayBuffer(4800))
    socket.receive({ type: 'turn.end', turn_id: 'timed' })
    expect(latency.mock.calls.map(([event]) => event.type)).toEqual([
      'session.stopped',
      'connect.started',
      'session.ready',
      'turn.started',
      'transcript.first',
      'audio.first',
      'turn.completed',
    ])
    expect(JSON.stringify(latency.mock.calls)).not.toContain('private')
  })

  it('negotiates streaming and continuously sends 640-byte voiced and silent frames after ready', async () => {
    const session = useDuplexSession()
    cleanups.push(session.stop)
    await session.start('ws://localhost/voice', { character_id: 'demo', type: 'override' })
    const socket = SocketMock.instances[0]
    const capture = WorkletNodeMock.instances[0]
    expect(session.state.value).toBe('connecting')
    capture.emit(frame())
    expect(socket.sent).toHaveLength(0)
    socket.open()
    expect(socket.binaryType).toBe('arraybuffer')
    expect(socket.events()).toEqual([{ character_id: 'demo', type: 'session.start', provider: 'seeduplex', codec: 'pcm_s16le', input_rate: 16000, streaming: true, client_vad: true }])
    capture.emit(frame())
    expect(socket.sent.filter(value => value instanceof ArrayBuffer)).toHaveLength(0)
    socket.receive({ type: 'session.ready', streaming: true, input_rate: 16000, output_rate: 24000 })
    const frames = Array.from({ length: 100 }, (_, index) => frame(index % 2 ? 0.2 : 0))
    frames.forEach(value => capture.emit(value))
    expect(session.state.value).toBe('listening')
    expect(session.active.value).toBe(true)
    expect(socket.sent.filter(value => value instanceof ArrayBuffer)).toEqual(frames.map(value => value.pcm))
    expect(session.rms.value).toBe(0.2)
    expect(session.peak.value).toBe(0.2)
  })

  it('mutes upstream microphone frames without closing the live session', async () => {
    const { session, socket, capture } = await connectSession()
    for (let index = 0; index < 3; index++)
      capture.emit(frame(0.2))
    expect(socket.sent.filter(value => value instanceof ArrayBuffer)).toHaveLength(3)
    expect(socket.events()).toContainEqual({ type: 'input.activity', active: true })

    expect(session.setMuted(true)).toBe(true)
    expect(session.muted.value).toBe(true)
    expect(session.active.value).toBe(true)
    expect(socket.close).not.toHaveBeenCalled()
    expect(socket.events()).toContainEqual({ type: 'input.activity', active: false })
    capture.emit(frame(0.5))
    expect(socket.sent.filter(value => value instanceof ArrayBuffer)).toHaveLength(3)
    expect(session.rms.value).toBe(0)
    expect(session.peak.value).toBe(0)

    expect(session.toggleMuted()).toBe(true)
    capture.emit(frame(0.2))
    expect(session.muted.value).toBe(false)
    expect(socket.sent.filter(value => value instanceof ArrayBuffer)).toHaveLength(4)
    expect(session.rms.value).toBe(0.2)
  })

  it('plays chunks in order and acknowledges completion only after the last audio node drains', async () => {
    const { session, socket, player, transcript, turn } = await connectSession()
    socket.receive({ type: 'input.speech.started', turn_id: 'one' })
    expect(session.state.value).toBe('speaking')
    socket.receive({ type: 'asr.delta', turn_id: 'one', text: '你' })
    socket.receive({ type: 'asr.delta', turn_id: 'one', text: '好' })
    expect(session.transcript.value).toBe('你好')
    socket.receive({ type: 'asr.final', turn_id: 'one', text: '你好' })
    expect(transcript).toHaveBeenCalledExactlyOnceWith('你好')
    socket.receive({ type: 'input.speech.stopped', turn_id: 'one' })
    expect(session.state.value).toBe('thinking')
    socket.receive({ type: 'assistant.text.delta', turn_id: 'one', text: '你' })
    socket.receive({ type: 'assistant.text.delta', turn_id: 'one', text: '好！' })
    expect(session.answer.value).toBe('你好！')
    socket.receive({ type: 'assistant.audio.start', turn_id: 'one', sample_rate: OUTPUT_RATE, channels: 1 })
    socket.receive(new ArrayBuffer(4800))
    socket.receive(new ArrayBuffer(9600))
    expect(session.state.value).toBe('playing')
    expect(player.sources[0].start).toHaveBeenCalledWith(1.08)
    expect(player.sources[1].start.mock.calls[0][0]).toBeCloseTo(1.18)
    socket.receive({ type: 'assistant.audio.end', turn_id: 'one' })
    socket.receive({ type: 'turn.end', turn_id: 'one' })
    socket.receive({ type: 'turn.end', turn_id: 'one' })
    expect(turn).toHaveBeenCalledExactlyOnceWith('你好', '你好！')
    expect(socket.events().filter(event => event.type === 'playback.complete')).toEqual([])
    player.sources[0].finish()
    expect(session.state.value).toBe('playing')
    player.sources[1].finish()
    expect(session.state.value).toBe('listening')
    expect(socket.events().filter(event => event.type === 'playback.complete')).toEqual([{ type: 'playback.complete', turn_id: 'one' }])
  })

  it.each(['drain-first', 'server-first'])('does not revive a completed turn when late audio arrives: %s', async (order) => {
    const { session, socket, player, transcript } = await connectSession()
    socket.receive({ type: 'assistant.audio.start', turn_id: 'finished', sample_rate: OUTPUT_RATE })
    socket.receive(new ArrayBuffer(4800))
    socket.receive({ type: 'assistant.audio.end', turn_id: 'finished' })
    if (order === 'drain-first') {
      player.sources[0].finish()
      socket.receive({ type: 'assistant.audio.start', turn_id: 'finished', sample_rate: OUTPUT_RATE })
      socket.receive(new ArrayBuffer(4800))
      expect(player.sources).toHaveLength(1)
      expect(session.state.value).toBe('listening')
    }
    socket.receive({ type: 'assistant.text.final', turn_id: 'finished', text: 'final answer after audio' })
    expect(session.answer.value).toBe('final answer after audio')
    socket.receive({ type: 'turn.end', turn_id: 'finished' })
    if (order === 'server-first') {
      expect(session.state.value).toBe('playing')
      expect(socket.events().some(event => event.type === 'playback.complete')).toBe(false)
      socket.receive({ type: 'assistant.audio.start', turn_id: 'finished', sample_rate: OUTPUT_RATE })
      socket.receive(new ArrayBuffer(4800))
      expect(player.sources).toHaveLength(1)
      expect(player.sources[0].stop).not.toHaveBeenCalled()
      player.sources[0].finish()
    }
    expect(session.state.value).toBe('listening')
    socket.receive({ type: 'assistant.audio.start', turn_id: 'finished', sample_rate: OUTPUT_RATE })
    socket.receive(new ArrayBuffer(4800))
    socket.receive({ type: 'input.speech.started', turn_id: 'finished' })
    socket.receive({ type: 'asr.final', turn_id: 'finished', text: 'stale question' })
    socket.receive({ type: 'assistant.text.delta', turn_id: 'finished', text: 'stale answer' })
    expect(player.sources).toHaveLength(1)
    expect(session.state.value).toBe('listening')
    expect(session.answer.value).toBe('final answer after audio')
    expect(transcript).not.toHaveBeenCalled()
    expect(socket.events().filter(event => event.type === 'playback.complete')).toEqual([{ type: 'playback.complete', turn_id: 'finished' }])
  })

  it.each(['seeduplex_timeout', 'seeduplex_unavailable'])('ignores a retired turn error without cancelling the new turn: %s', async (code) => {
    const { session, socket, player } = await connectSession()
    socket.receive({ type: 'assistant.audio.start', turn_id: 'old', sample_rate: OUTPUT_RATE })
    socket.receive(new ArrayBuffer(4800))
    socket.receive({ type: 'input.speech.started', turn_id: 'new' })
    socket.receive({ type: 'assistant.audio.start', turn_id: 'new', sample_rate: OUTPUT_RATE })
    socket.receive(new ArrayBuffer(4800))
    socket.receive({ type: 'error', turn_id: 'old', code })
    expect(session.active.value).toBe(true)
    expect(session.state.value).toBe('playing')
    expect(session.errorCode.value).toBe('')
    expect(player.sources[1].stop).not.toHaveBeenCalled()
    expect(socket.events().some(event => event.type === 'assistant.cancel')).toBe(false)
    socket.receive({ type: 'assistant.audio.end', turn_id: 'new' })
    socket.receive({ type: 'turn.end', turn_id: 'new' })
    player.sources[1].finish()
    expect(socket.events().filter(event => event.type === 'playback.complete')).toEqual([{ type: 'playback.complete', turn_id: 'new' }])
  })

  it('interrupts once, stops playback and rejects late cancelled-turn text, audio and completion', async () => {
    const { session, socket, player } = await connectSession()
    socket.receive({ type: 'assistant.audio.start', turn_id: 'old', sample_rate: OUTPUT_RATE })
    socket.receive(new ArrayBuffer(4800))
    const oldEnded = player.sources[0].onended!
    session.interrupt()
    session.interrupt()
    expect(player.sources[0].stop).toHaveBeenCalledOnce()
    expect(socket.events().filter(event => event.type === 'assistant.cancel')).toEqual([{ type: 'assistant.cancel', turn_id: 'old' }])
    socket.receive({ type: 'assistant.audio.start', turn_id: 'old', sample_rate: OUTPUT_RATE })
    socket.receive(new ArrayBuffer(4800))
    socket.receive({ type: 'assistant.text.delta', turn_id: 'old', text: 'late' })
    socket.receive({ type: 'asr.final', turn_id: 'old', text: 'late' })
    expect(player.sources).toHaveLength(1)
    expect(session.answer.value).toBe('')
    expect(session.transcript.value).toBe('')
    socket.receive({ type: 'input.speech.started', turn_id: 'new' })
    socket.receive({ type: 'assistant.audio.start', turn_id: 'new', sample_rate: OUTPUT_RATE })
    socket.receive(new ArrayBuffer(4800))
    socket.receive({ type: 'assistant.audio.end', turn_id: 'new' })
    oldEnded(new Event('ended'))
    expect(socket.events().filter(event => event.type === 'playback.complete')).toEqual([])
    player.sources[1].finish()
    expect(socket.events().filter(event => event.type === 'playback.complete')).toEqual([{ type: 'playback.complete', turn_id: 'new' }])
  })

  it('uses consecutive voice and quiet frames to interrupt automatically while still streaming all frames', async () => {
    const { socket, capture, player } = await connectSession()
    socket.receive({ type: 'assistant.audio.start', turn_id: 'old', sample_rate: OUTPUT_RATE })
    socket.receive(new ArrayBuffer(4800))
    capture.emit(frame(0.1))
    capture.emit(frame(0.1))
    expect(socket.events().some(event => event.type === 'input.activity')).toBe(false)
    capture.emit(frame(0.1))
    expect(player.sources[0].stop).toHaveBeenCalledOnce()
    expect(socket.events().filter(event => event.type === 'input.activity')).toEqual([{ type: 'input.activity', active: true }])
    for (let index = 0; index < 14; index++)
      capture.emit(frame())
    expect(socket.events().filter(event => event.type === 'input.activity')).toHaveLength(1)
    capture.emit(frame())
    expect(socket.events().filter(event => event.type === 'input.activity')).toEqual([{ type: 'input.activity', active: true }, { type: 'input.activity', active: false }])
    expect(socket.sent.filter(value => value instanceof ArrayBuffer)).toHaveLength(18)
  })

  it('keeps the current user turn alive when local voice activity starts during speech capture', async () => {
    const { session, socket, capture, transcript } = await connectSession()
    socket.receive({ type: 'input.speech.started', turn_id: 'user-speaking' })
    for (let index = 0; index < 3; index++)
      capture.emit(frame(0.2))
    expect(session.state.value).toBe('speaking')
    expect(socket.events()).toContainEqual({ type: 'input.activity', active: true })
    expect(socket.events().some(event => event.type === 'assistant.cancel')).toBe(false)
    socket.receive({ type: 'asr.delta', turn_id: 'user-speaking', text: '你好' })
    socket.receive({ type: 'asr.final', turn_id: 'user-speaking', text: '你好' })
    expect(session.transcript.value).toBe('你好')
    expect(transcript).toHaveBeenCalledExactlyOnceWith('你好')
  })

  it('resets over the existing socket and isolates audio, text and capture until renegotiation', async () => {
    const { session, socket, player, capture, transcript } = await connectSession()
    socket.receive({ type: 'input.speech.started', turn_id: 'retired' })
    socket.receive({ type: 'asr.final', turn_id: 'retired', text: 'old question' })
    socket.receive({ type: 'assistant.text.delta', turn_id: 'retired', text: 'old answer' })
    socket.receive({ type: 'assistant.audio.start', turn_id: 'retired', sample_rate: OUTPUT_RATE })
    socket.receive(new ArrayBuffer(4800))
    const oldEnded = player.sources[0].onended!
    session.reset()
    session.reset()
    expect(session.state.value).toBe('connecting')
    expect(session.active.value).toBe(true)
    expect(session.transcript.value).toBe('')
    expect(session.answer.value).toBe('')
    expect(player.sources[0].stop).toHaveBeenCalledOnce()
    expect(socket.events().filter(event => event.type === 'session.reset')).toEqual([{ type: 'session.reset' }])
    expect(ContextMock.instances).toHaveLength(2)
    expect(SocketMock.instances).toHaveLength(1)
    expect(track.stop).not.toHaveBeenCalled()
    socket.receive({ type: 'input.speech.started', turn_id: 'late-during-reset' })
    socket.receive({ type: 'asr.final', turn_id: 'late-during-reset', text: 'late transcript' })
    socket.receive({ type: 'assistant.text.delta', turn_id: 'late-during-reset', text: 'late answer' })
    socket.receive({ type: 'assistant.audio.start', turn_id: 'late-during-reset', sample_rate: OUTPUT_RATE })
    socket.receive(new ArrayBuffer(4800))
    capture.emit(frame(0.5))
    oldEnded(new Event('ended'))
    expect(session.state.value).toBe('connecting')
    expect(session.transcript.value).toBe('')
    expect(session.answer.value).toBe('')
    expect(transcript).toHaveBeenCalledTimes(1)
    expect(player.sources).toHaveLength(1)
    expect(socket.sent.filter(value => value instanceof ArrayBuffer)).toHaveLength(0)
    expect(socket.events().some(event => event.type === 'playback.complete')).toBe(false)
    socket.receive({ type: 'session.ready', streaming: true, input_rate: 16000, output_rate: 24000 })
    socket.receive({ type: 'asr.final', turn_id: 'retired', text: 'retired transcript' })
    socket.receive({ type: 'assistant.audio.start', turn_id: 'retired', sample_rate: OUTPUT_RATE })
    socket.receive(new ArrayBuffer(4800))
    expect(player.sources).toHaveLength(1)
    expect(session.transcript.value).toBe('')
    socket.receive({ type: 'input.speech.started', turn_id: 'fresh' })
    socket.receive({ type: 'asr.final', turn_id: 'fresh', text: 'new question' })
    capture.emit(frame())
    expect(session.transcript.value).toBe('new question')
    expect(transcript).toHaveBeenLastCalledWith('new question')
    expect(socket.sent.filter(value => value instanceof ArrayBuffer)).toHaveLength(1)
  })

  it('times out a reset handshake and cancels its timer when renegotiation succeeds', async () => {
    vi.useFakeTimers()
    const { session, socket } = await connectSession()
    session.reset()
    vi.advanceTimersByTime(14999)
    expect(session.active.value).toBe(true)
    socket.receive({ type: 'session.ready', streaming: true, input_rate: 16000, output_rate: 24000 })
    vi.advanceTimersByTime(15000)
    expect(session.active.value).toBe(true)
    expect(session.errorCode.value).toBe('')
    session.reset()
    vi.advanceTimersByTime(15000)
    expect(session.active.value).toBe(false)
    expect(session.errorCode.value).toBe('seeduplex_timeout')
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it('pauses congested socket writes, recovers, and stops after sustained backpressure', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const { session, socket, capture, player } = await connectSession()
    socket.bufferedAmount = MAX_SOCKET_BUFFER + 1
    capture.emit(frame())
    expect(session.congested.value).toBe(true)
    expect(socket.sent.filter(value => value instanceof ArrayBuffer)).toHaveLength(0)
    vi.advanceTimersByTime(2000)
    socket.bufferedAmount = 0
    capture.emit(frame())
    expect(session.congested.value).toBe(false)
    expect(socket.sent.filter(value => value instanceof ArrayBuffer)).toHaveLength(1)
    socket.bufferedAmount = MAX_SOCKET_BUFFER + 1
    capture.emit(frame())
    vi.advanceTimersByTime(3001)
    capture.emit(frame())
    expect(session.errorCode.value).toBe('audio_backpressure')
    expect(session.active.value).toBe(false)
    expect(session.state.value).toBe('idle')
    expect(socket.close).toHaveBeenCalledWith(1000, 'session stopped')
    expect(track.stop).toHaveBeenCalledOnce()
    expect(player.close).toHaveBeenCalledOnce()
  })

  it('propagates player backpressure and releases playback, capture and socket resources', async () => {
    const { session, socket, player } = await connectSession()
    socket.receive({ type: 'assistant.audio.start', turn_id: 'full', sample_rate: OUTPUT_RATE })
    for (let index = 0; index < 8; index++)
      socket.receive(new ArrayBuffer(OUTPUT_RATE * 2))
    expect(session.errorCode.value).toBe('audio_backpressure')
    expect(session.active.value).toBe(false)
    expect(player.sources).toHaveLength(7)
    player.sources.forEach(source => expect(source.stop).toHaveBeenCalledOnce())
    expect(track.stop).toHaveBeenCalledOnce()
    expect(socket.onmessage).toBeNull()
    expect(ContextMock.instances.every(context => context.state === 'closed')).toBe(true)
  })

  it('stops cleanly, ignores retained old-session callbacks and can reconnect', async () => {
    const { session, socket, capture, player } = await connectSession()
    socket.receive({ type: 'assistant.audio.start', turn_id: 'old', sample_rate: OUTPUT_RATE })
    socket.receive(new ArrayBuffer(4800))
    const oldMessage = socket.onmessage!
    const oldOpen = socket.onopen!
    const oldError = socket.onerror!
    const oldCapture = capture.port.onmessage!
    const oldEnded = player.sources[0].onended!
    const oldTrack = track
    session.stop()
    expect(socket.events()).toContainEqual({ type: 'session.stop' })
    expect(socket.onopen).toBeNull()
    expect(socket.onmessage).toBeNull()
    expect(socket.onerror).toBeNull()
    expect(socket.onclose).toBeNull()
    expect(capture.port.close).toHaveBeenCalledOnce()
    expect(oldTrack.stop).toHaveBeenCalledOnce()
    expect(ContextMock.instances.every(context => context.state === 'closed')).toBe(true)
    await session.start('ws://localhost/voice')
    const nextSocket = SocketMock.instances[1]
    nextSocket.open()
    nextSocket.receive({ type: 'session.ready', streaming: true, input_rate: 16000, output_rate: 24000 })
    oldMessage(new MessageEvent('message', { data: JSON.stringify({ type: 'error', code: 'invalid_audio_frame' }) }))
    oldOpen(new Event('open'))
    oldError(new Event('error'))
    oldCapture(new MessageEvent('message', { data: frame(0.5) }))
    oldEnded(new Event('ended'))
    expect(session.active.value).toBe(true)
    expect(session.state.value).toBe('listening')
    expect(session.errorCode.value).toBe('')
    expect(nextSocket.events().map(event => event.type)).toEqual(['session.start'])
    expect(nextSocket.sent.filter(value => value instanceof ArrayBuffer)).toHaveLength(0)
    session.stop()
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it('prevents an asynchronously granted microphone from reviving a stopped session', async () => {
    const permission = deferred<MediaStream>()
    getUserMedia.mockReturnValue(permission.promise)
    const session = useDuplexSession()
    cleanups.push(session.stop)
    const start = session.start('ws://localhost/voice')
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce())
    session.stop()
    permission.resolve(media)
    await start
    expect(SocketMock.instances).toHaveLength(0)
    expect(session.active.value).toBe(false)
    expect(session.state.value).toBe('idle')
    expect(track.stop).toHaveBeenCalledOnce()
    expect(ContextMock.instances.every(context => context.state === 'closed')).toBe(true)
  })

  it('offers the turn-based fallback without requesting resources on unsupported devices', async () => {
    vi.stubGlobal('AudioWorkletNode', undefined)
    const session = useDuplexSession()
    cleanups.push(session.stop)
    await session.start('ws://localhost/voice')
    expect(session.errorCode.value).toBe('duplex_not_supported')
    expect(session.error.value).toContain('按轮模式')
    expect(session.active.value).toBe(false)
    expect(session.state.value).toBe('idle')
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(ContextMock.instances).toHaveLength(0)
    expect(SocketMock.instances).toHaveLength(0)
  })

  it('reports stable codes for malformed endpoints and unknown server failures', async () => {
    const malformed = useDuplexSession()
    cleanups.push(malformed.stop)
    await malformed.start('not a websocket URL')
    expect(malformed.errorCode.value).toBe('invalid_voice_endpoint')

    const { session, socket } = await connectSession()
    socket.receive({ type: 'error', code: 'future_private_provider_error', message: 'unsafe upstream detail' })
    expect(session.errorCode.value).toBe('seeduplex_unavailable')
    expect(session.error.value).not.toContain('unsafe upstream detail')
  })

  it.each([
    { streaming: false, input_rate: 16000, output_rate: 24000 },
    { streaming: true, input_rate: 48000, output_rate: 24000 },
    { streaming: true, input_rate: 16000, output_rate: 16000 },
  ])('falls back when server negotiation is unsupported: %o', async (metadata) => {
    const { session, socket } = await connectSession()
    socket.receive({ type: 'session.ready', ...metadata })
    expect(session.errorCode.value).toBe('duplex_not_supported')
    expect(session.active.value).toBe(false)
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it('classifies microphone rejection and device revocation and frees all contexts', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
    const session = useDuplexSession()
    cleanups.push(session.stop)
    await session.start('ws://localhost/voice')
    expect(session.errorCode.value).toBe('microphone_denied')
    expect(SocketMock.instances).toHaveLength(0)
    expect(ContextMock.instances.every(context => context.state === 'closed')).toBe(true)
    await session.start('ws://localhost/voice')
    track.end()
    expect(session.errorCode.value).toBe('microphone_denied')
    expect(session.active.value).toBe(false)
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it('recognizes permission errors by browser exception name across realms', async () => {
    getUserMedia.mockRejectedValueOnce({ name: 'SecurityError', message: 'Microphone policy blocked' })
    const session = useDuplexSession()
    cleanups.push(session.stop)
    await session.start('ws://localhost/voice')
    expect(session.errorCode.value).toBe('microphone_denied')
    expect(session.active.value).toBe(false)
    expect(ContextMock.instances.every(context => context.state === 'closed')).toBe(true)
  })

  it('times out unready handshakes and clears the timer after a successful handshake', async () => {
    vi.useFakeTimers()
    const session = useDuplexSession()
    cleanups.push(session.stop)
    await session.start('ws://localhost/voice')
    vi.advanceTimersByTime(15000)
    expect(session.errorCode.value).toBe('seeduplex_timeout')
    expect(session.active.value).toBe(false)
    await session.start('ws://localhost/voice')
    const socket = SocketMock.instances[1]
    socket.open()
    socket.receive({ type: 'session.ready', streaming: true, input_rate: 16000, output_rate: 24000 })
    vi.advanceTimersByTime(16000)
    expect(session.active.value).toBe(true)
    expect(session.errorCode.value).toBe('')
  })

  it('recovers from a turn timeout by cancelling playback without ending the live session', async () => {
    const { session, socket, player } = await connectSession()
    socket.receive({ type: 'assistant.audio.start', turn_id: 'timed-out', sample_rate: OUTPUT_RATE })
    socket.receive(new ArrayBuffer(4800))
    socket.receive({ type: 'error', code: 'seeduplex_timeout' })
    expect(session.active.value).toBe(true)
    expect(session.state.value).toBe('listening')
    expect(session.errorCode.value).toBe('seeduplex_timeout')
    expect(player.sources[0].stop).toHaveBeenCalledOnce()
    expect(socket.events()).toContainEqual({ type: 'assistant.cancel', turn_id: 'timed-out' })
    expect(track.stop).not.toHaveBeenCalled()
  })

  it.each(['missing', 'mismatched', 'matching'])('verifies the selected alternate character acknowledgement: %s', async (mode) => {
    const session = useDuplexSession()
    cleanups.push(session.stop)
    await session.start('ws://localhost/voice', { character_id: 'linxi', persona_id: 'linxi', voice_id: 'linxi' })
    const socket = SocketMock.instances[0]
    socket.open()
    const confirmed = mode === 'matching' ? 'linxi' : 'zhixia'
    socket.receive({ type: 'session.ready', streaming: true, input_rate: 16000, output_rate: 24000, ...(mode === 'missing' ? {} : { character_id: confirmed, persona_id: confirmed, voice_id: confirmed }) })
    expect(session.active.value).toBe(mode === 'matching')
    expect(session.errorCode.value).toBe(mode === 'matching' ? '' : 'unsupported_character')
    if (mode === 'matching') {
      socket.receive({ type: 'input.speech.started', turn_id: 'speaking' })
      socket.receive({ type: 'session.ready', streaming: true, input_rate: 16000, output_rate: 24000, character_id: 'linxi', persona_id: 'linxi', voice_id: 'linxi' })
      expect(session.state.value).toBe('speaking')
    }
  })

  it('fails closed on malformed event metadata or invalid audio chunks', async () => {
    const { session, socket } = await connectSession()
    socket.receive('{"type":"assistant.audio.start","turn_id":7}')
    expect(session.errorCode.value).toBe('invalid_audio_frame')
    expect(session.active.value).toBe(false)
    expect(track.stop).toHaveBeenCalledOnce()
    await session.start('ws://localhost/voice')
    const nextSocket = SocketMock.instances[1]
    nextSocket.open()
    nextSocket.receive({ type: 'session.ready', streaming: true, input_rate: 16000, output_rate: 24000 })
    nextSocket.receive({ type: 'assistant.audio.start', turn_id: 'bad-pcm' })
    nextSocket.receive(new ArrayBuffer(3))
    expect(session.errorCode.value).toBe('invalid_audio_frame')
    expect(session.active.value).toBe(false)
  })

  it('stops a session when cumulative caption deltas exceed the text budget', async () => {
    const { session, socket } = await connectSession()
    socket.receive({ type: 'input.speech.started', turn_id: 'bounded' })
    socket.receive({ type: 'asr.delta', turn_id: 'bounded', text: 'x'.repeat(MAX_VOICE_TEXT_CHARS) })
    expect(session.active.value).toBe(true)
    socket.receive({ type: 'asr.delta', turn_id: 'bounded', text: 'x' })
    expect(session.errorCode.value).toBe('invalid_audio_frame')
    expect(session.active.value).toBe(false)
    expect(track.stop).toHaveBeenCalledOnce()
  })
})
