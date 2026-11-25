import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VOICE_PROVIDER_STORAGE_KEY } from '@/composables/voice/useVoiceProviderPreference'
import { CONVERSATION_ARCHIVE_STORAGE_KEY } from '@/composables/voice/conversationArchive'
import Voice from './voice.vue'

const hideState = vi.hoisted(() => ({ handler: undefined as (() => void) | undefined }))
vi.mock('@dcloudio/uni-app', () => ({
  onHide: (handler: () => void) => { hideState.handler = handler },
  onLoad: vi.fn(),
}))
vi.mock('@/api/voice', () => ({
  getVoiceStatus: vi.fn(async () => ({})),
  getVoiceTasks: vi.fn(async () => ({})),
  getVoiceTodos: vi.fn(async () => ({ items: [] })),
  setVoiceTodo: vi.fn(),
  startVoiceTask: vi.fn(),
}))
vi.mock('@/store/settings', () => ({ useSettingsStore: () => ({ serverBaseUrl: 'http://localhost:8000', clientConfig: { provider: 'gemini', apiKey: '', baseUrl: '', model: '' }, useMock: true }) }))

type Handler = (event?: unknown) => void
interface MockSocket {
  handlers: Record<string, Handler>
  send: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  onOpen: (fn: Handler) => void
  onClose: (fn: Handler) => void
  onError: (fn: Handler) => void
  onMessage: (fn: Handler) => void
}
interface MockProcessor {
  onaudioprocess: ((event: AudioProcessingEvent) => void) | null
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}
interface MockTrack { stop: ReturnType<typeof vi.fn> }
interface ReadFileOptions { filePath: string, success: (result: { data: string | ArrayBuffer }) => void, fail: () => void }
interface WriteFileOptions { filePath: string, success: () => void, fail: () => void }
interface MockAudio {
  src: string
  onended: (() => void) | null
  onerror: (() => void) | null
  play: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  removeAttribute: ReturnType<typeof vi.fn>
  load: ReturnType<typeof vi.fn>
}

function socketMock() {
  const handlers: Record<string, Handler> = {}
  return {
    handlers,
    send: vi.fn(),
    close: vi.fn(),
    onOpen: (fn: Handler) => { handlers.open = fn },
    onClose: (fn: Handler) => { handlers.close = fn },
    onError: (fn: Handler) => { handlers.error = fn },
    onMessage: (fn: Handler) => { handlers.message = fn },
  }
}
function nodeMock() {
  return { connect: vi.fn(), disconnect: vi.fn() }
}

let sockets: MockSocket[]
let processors: MockProcessor[]
let tracks: MockTrack[]
let audios: MockAudio[]
let wrappers: ReturnType<typeof mount>[]
let recorder: { start: ReturnType<typeof vi.fn>, stop: ReturnType<typeof vi.fn> }
let reads: ReadFileOptions[]
let writes: WriteFileOptions[]
let unlinks: string[]
let getUserMedia: ReturnType<typeof vi.fn>
let audioSampleRate: number
let originalCreateObjectURL: PropertyDescriptor | undefined
let originalRevokeObjectURL: PropertyDescriptor | undefined

beforeEach(() => {
  vi.stubGlobal('definePage', vi.fn())
  localStorage.removeItem(VOICE_PROVIDER_STORAGE_KEY)
  uni.removeStorageSync(VOICE_PROVIDER_STORAGE_KEY)
  sockets = []
  processors = []
  tracks = []
  audios = []
  wrappers = []
  reads = []
  writes = []
  unlinks = []
  hideState.handler = undefined
  audioSampleRate = 48000
  recorder = { start: vi.fn(), stop: vi.fn() }
  getUserMedia = vi.fn(async () => {
    const track = { stop: vi.fn() }
    tracks.push(track)
    return { getTracks: () => [track] } as unknown as MediaStream
  })
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  vi.stubGlobal('AudioContext', class {
    sampleRate = audioSampleRate
    state: AudioContextState = 'running'
    destination = {} as AudioDestinationNode
    resume = vi.fn(async () => {})
    close = vi.fn(async () => { this.state = 'closed' })

    createMediaStreamSource = vi.fn(() => nodeMock() as unknown as MediaStreamAudioSourceNode)
    createScriptProcessor = vi.fn(() => {
      const processor: MockProcessor = { ...nodeMock(), onaudioprocess: null }
      processors.push(processor)
      return processor as unknown as ScriptProcessorNode
    })

    createGain = vi.fn(() => ({ ...nodeMock(), gain: { value: 1 } }) as unknown as GainNode)
  })
  vi.stubGlobal('Audio', class {
    src: string
    onended: (() => void) | null = null
    onerror: (() => void) | null = null
    play = vi.fn(async () => {})
    pause = vi.fn()
    removeAttribute = vi.fn((name: string) => {
      if (name === 'src')
        this.src = ''
    })

    load = vi.fn()
    constructor(src: string) {
      this.src = src
      audios.push(this)
    }
  })
  originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:voice-reply') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  Object.assign(uni, {
    env: { USER_DATA_PATH: '/tmp' },
    getRecorderManager: () => ({
      ...recorder,
      onFrameRecorded: vi.fn(),
      onStop: vi.fn(),
      onError: vi.fn(),
    }),
    connectSocket: () => {
      const socket = socketMock()
      sockets.push(socket)
      return socket
    },
    createInnerAudioContext: vi.fn(),
    arrayBufferToBase64: () => 'audio',
    getFileSystemManager: () => ({
      writeFile: (options: WriteFileOptions) => writes.push(options),
      readFile: (options: ReadFileOptions) => reads.push(options),
      unlink: ({ filePath }: { filePath: string }) => unlinks.push(filePath),
    }),
  })
})
afterEach(() => {
  wrappers.forEach(wrapper => wrapper.unmount())
  if (originalCreateObjectURL)
    Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL)
  else
    Reflect.deleteProperty(URL, 'createObjectURL')
  if (originalRevokeObjectURL)
    Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURL)
  else
    Reflect.deleteProperty(URL, 'revokeObjectURL')
  vi.unstubAllGlobals()
})

function render() {
  const wrapper = mount(Voice, { global: { stubs: { picker: { template: '<div><slot /></div>' } } } })
  wrappers.push(wrapper)
  return wrapper
}
function message(socket: MockSocket, type: string, turn_id?: string, extra: { segment?: boolean, text?: string } = {}) {
  socket.handlers.message({ data: JSON.stringify({ type, turn_id, ...extra }) })
}
function sent(socket: MockSocket) {
  return socket.send.mock.calls
    .map(([options]) => options.data)
    .filter(data => typeof data === 'string')
    .map(data => JSON.parse(data) as { type: string, turn_id?: string, provider?: string, codec?: string })
}
async function record(wrapper: ReturnType<typeof mount>) {
  const socketCount = sockets.length
  await wrapper.find('.voice-button').trigger('tap')
  await flushPromises()
  const socket = sockets.at(-1)!
  if (sockets.length !== socketCount) {
    socket.handlers.open()
    message(socket, 'session.ready')
    await flushPromises()
  }
  await flushPromises()
  return socket
}
function capture(samples = new Float32Array(4800).fill(0.5)) {
  const processor = processors.at(-1)!
  processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => samples } } as unknown as AudioProcessingEvent)
}
async function stopRecording(wrapper: ReturnType<typeof mount>, socket: MockSocket) {
  capture()
  await wrapper.find('.voice-button.recording').trigger('tap')
  await flushPromises()
  return sent(socket).findLast(event => event.type === 'input.end')?.turn_id ?? ''
}
function reply(socket: MockSocket, turn: string, binary: ArrayBuffer | Blob = new ArrayBuffer(44)) {
  message(socket, 'assistant.audio.start', turn)
  socket.handlers.message({ data: binary })
  message(socket, 'assistant.audio.end', turn)
}
function binaryMessages(socket: MockSocket) {
  return socket.send.mock.calls.map(([options]) => options.data).filter((data): data is ArrayBuffer => data instanceof ArrayBuffer)
}

describe('voice cross-platform lifecycle', () => {
  it('refreshes local storage usage after a conversation is archived', async () => {
    localStorage.removeItem(CONVERSATION_ARCHIVE_STORAGE_KEY)
    const wrapper = render()
    const socket = await record(wrapper)
    const turn = await stopRecording(wrapper, socket)
    message(socket, 'asr.final', turn, { text: '统计本地记录' })
    message(socket, 'assistant.text.delta', turn, { text: '已记录' })
    message(socket, 'turn.end', turn)
    await flushPromises()

    expect(wrapper.text()).toContain('对话与保留期限：1 项')
  })

  it('clearly offers turn mode when AudioWorklet duplex capture is unavailable', async () => {
    const wrapper = render()
    await wrapper.findAll('.provider-options .provider-option')[1].trigger('tap')
    expect(wrapper.text()).toContain('当前设备不支持免提通话')
    expect(wrapper.find('.duplex-button').exists()).toBe(false)
    expect(wrapper.find('.voice-button').exists()).toBe(true)
    expect(sockets).toHaveLength(0)
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('keeps the microphone and voice state active when independent portrait generation fails', async () => {
    const wrapper = render()
    await record(wrapper)
    const portraitButton = wrapper.findAll('button').find(button => button.text() === '生成高清写真')!
    await portraitButton.trigger('tap')
    await flushPromises()
    expect(wrapper.text()).toContain('当前开启模拟数据')
    expect(wrapper.find('.voice-button.recording').exists()).toBe(true)
    expect(tracks[0].stop).not.toHaveBeenCalled()
  })

  it('negotiates 16k PCM on H5, resamples one round, and stops the microphone', async () => {
    const wrapper = render()
    const socket = await record(wrapper)
    const turn = await stopRecording(wrapper, socket)
    const start = sent(socket).find(event => event.type === 'session.start')
    expect(start).toMatchObject({ codec: 'pcm_s16le', provider: 'local' })
    expect(turn).not.toBe('')
    expect(binaryMessages(socket)).toHaveLength(1)
    const pcm = binaryMessages(socket)[0]
    expect(pcm.byteLength).toBe(3200)
    expect(new DataView(pcm).getInt16(0, true)).toBe(16383)
    expect(tracks[0].stop).toHaveBeenCalledOnce()
    expect(recorder.start).not.toHaveBeenCalled()
  })

  it('shows RMS and peak from captured samples without claiming recognition success', async () => {
    const wrapper = render()
    await record(wrapper)
    capture(new Float32Array([0, 0.5, 0, -0.5]))
    await flushPromises()
    expect(wrapper.find('.mic-diagnostics').text()).toContain('RMS -9 dBFS · 峰值 -6 dBFS')
    expect(wrapper.find('.mic-diagnostics').text()).toContain('检测到输入信号')
    capture(new Float32Array(4800))
    await flushPromises()
    expect(wrapper.find('.mic-diagnostics').text()).toContain('当前未检测到声音')
    expect(wrapper.find('.mic-diagnostics').text()).toContain('本轮此前已检测到信号')
  })

  it('rejects digital silence and near-zero input locally and resets detection for each round', async () => {
    const wrapper = render()
    const socket = await record(wrapper)
    for (const amplitude of [0, 0.000001]) {
      capture(new Float32Array(4800).fill(amplitude))
      await wrapper.find('.voice-button.recording').trigger('tap')
      await flushPromises()
      expect(binaryMessages(socket)).toHaveLength(0)
      expect(sent(socket).some(event => event.type === 'input.end')).toBe(false)
      expect(wrapper.text()).toContain('本轮录音未发送')
      expect(wrapper.text()).toContain('MuMu 宿主机')
      await record(wrapper)
    }
    capture(new Float32Array(4800).fill(0.001))
    await wrapper.find('.voice-button.recording').trigger('tap')
    message(socket, 'turn.end')
    await flushPromises()
    expect(binaryMessages(socket)).toHaveLength(1)
    await record(wrapper)
    capture(new Float32Array(4800))
    await wrapper.find('.voice-button.recording').trigger('tap')
    await flushPromises()
    expect(binaryMessages(socket)).toHaveLength(1)
    expect(sent(socket).filter(event => event.type === 'input.end')).toHaveLength(1)
    expect(sent(socket).filter(event => event.type === 'input.cancel')).toHaveLength(3)
  })

  it('keeps quiet input and sparse peaks eligible for recognition', async () => {
    for (const peakOnly of [false, true]) {
      const wrapper = render()
      const socket = await record(wrapper)
      const samples = new Float32Array(4800).fill(peakOnly ? 0 : 0.0002)
      if (peakOnly)
        samples[2400] = 0.001
      capture(samples)
      await wrapper.find('.voice-button.recording').trigger('tap')
      await flushPromises()
      expect(binaryMessages(socket)).toHaveLength(1)
      expect(sent(socket).some(event => event.type === 'input.end')).toBe(true)
      expect(wrapper.find('.voice-error').exists()).toBe(false)
      wrapper.unmount()
    }
  })

  it('caps H5 PCM capture at 64 seconds within the 2 MiB input ceiling', async () => {
    audioSampleRate = 16000
    const wrapper = render()
    const socket = await record(wrapper)
    capture(new Float32Array(16000 * 64 + 128).fill(0.25))
    const pcm = binaryMessages(socket)[0]
    expect(pcm.byteLength).toBe(16000 * 64 * 2)
    expect(pcm.byteLength).toBeLessThanOrEqual(2 * 1024 * 1024)
    expect(sent(socket).some(event => event.type === 'input.end')).toBe(true)
    expect(tracks[0].stop).toHaveBeenCalledOnce()
  })

  it('sends the same 16k PCM turn to SeedDuplex without the MP3 path', async () => {
    const wrapper = render()
    await wrapper.findAll('.provider-options .provider-option')[1].trigger('tap')
    const socket = await record(wrapper)
    const turn = await stopRecording(wrapper, socket)
    expect(sent(socket).find(event => event.type === 'session.start')).toMatchObject({ codec: 'pcm_s16le', provider: 'seeduplex' })
    expect(binaryMessages(socket)[0].byteLength).toBe(3200)
    expect(sent(socket).find(event => event.type === 'input.end')?.turn_id).toBe(turn)
  })

  it('plays segments in FIFO order and waits for turn.end before becoming idle', async () => {
    const wrapper = render()
    const socket = await record(wrapper)
    const turn = await stopRecording(wrapper, socket)
    for (const value of [1, 2]) {
      message(socket, 'assistant.audio.start', turn, { segment: true })
      socket.handlers.message({ data: new Uint8Array([value]).buffer })
      message(socket, 'assistant.audio.end', turn, { segment: true })
    }
    await flushPromises()
    expect(audios).toHaveLength(1)
    expect(audios[0].pause).not.toHaveBeenCalled()
    const firstBlob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    expect([...new Uint8Array(await firstBlob.arrayBuffer())]).toEqual([1])
    audios[0].onended?.()
    await flushPromises()
    expect(audios).toHaveLength(2)
    const secondBlob = vi.mocked(URL.createObjectURL).mock.calls[1][0] as Blob
    expect([...new Uint8Array(await secondBlob.arrayBuffer())]).toEqual([2])
    audios[1].onended?.()
    await flushPromises()
    expect(wrapper.find('.live-state').text()).toBe('识别与生成中')
    expect(wrapper.find('.voice-button').attributes('disabled')).toBeDefined()
    message(socket, 'turn.end', turn)
    await flushPromises()
    expect(wrapper.find('.live-state').text()).toBe('点击开始说话')
    expect(sent(socket).some(event => event.type === 'playback.complete')).toBe(false)
  })

  it('preserves delayed Blob byte order and keeps playing after turn.end until the queue drains', async () => {
    const wrapper = render()
    const socket = await record(wrapper)
    const turn = await stopRecording(wrapper, socket)
    let resolveBlob!: (buffer: ArrayBuffer) => void
    const blob = new Blob([new Uint8Array([1])])
    vi.spyOn(blob, 'arrayBuffer').mockImplementation(() => new Promise<ArrayBuffer>((resolve) => {
      resolveBlob = resolve
    }))
    message(socket, 'assistant.audio.start', turn, { segment: true })
    socket.handlers.message({ data: blob })
    socket.handlers.message({ data: new Uint8Array([2]).buffer })
    message(socket, 'assistant.audio.end', turn, { segment: true })
    message(socket, 'turn.end', turn)
    await flushPromises()
    expect(audios).toHaveLength(0)
    expect(wrapper.find('.live-state').text()).toBe('识别与生成中')
    resolveBlob(new Uint8Array([1]).buffer)
    await flushPromises()
    const played = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    expect([...new Uint8Array(await played.arrayBuffer())]).toEqual([1, 2])
    expect(wrapper.find('.live-state').text()).toBe('正在播放')
    audios[0].onended?.()
    await flushPromises()
    expect(wrapper.find('.live-state').text()).toBe('点击开始说话')
  })

  it('keeps Blob decoding in wire order and ignores late work after a canceled turn', async () => {
    const wrapper = render()
    const socket = await record(wrapper)
    const turn = await stopRecording(wrapper, socket)
    let resolveBlob!: (buffer: ArrayBuffer) => void
    const blob = new Blob([new Uint8Array([1])])
    vi.spyOn(blob, 'arrayBuffer').mockImplementation(() => new Promise<ArrayBuffer>((resolve) => {
      resolveBlob = resolve
    }))
    message(socket, 'assistant.audio.start', turn, { segment: true })
    socket.handlers.message({ data: blob })
    socket.handlers.message({ data: new Uint8Array([2]).buffer })
    message(socket, 'assistant.audio.end', turn, { segment: true })
    message(socket, 'assistant.audio.start', turn, { segment: true })
    socket.handlers.message({ data: new Uint8Array([3]).buffer })
    message(socket, 'assistant.audio.end', turn, { segment: true })
    await flushPromises()
    expect(audios).toHaveLength(0)
    await wrapper.find('.interrupt-button').trigger('tap')
    await record(wrapper)
    const nextTurn = await stopRecording(wrapper, socket)
    reply(socket, nextTurn, new Uint8Array([4]).buffer)
    await flushPromises()
    expect(audios).toHaveLength(1)
    resolveBlob(new Uint8Array([1]).buffer)
    await flushPromises()
    expect(audios).toHaveLength(1)
    const played = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    expect([...new Uint8Array(await played.arrayBuffer())]).toEqual([4])
  })

  it('discards queued audio on playback errors and enforces the total per-turn reply limit', async () => {
    const wrapper = render()
    const socket = await record(wrapper)
    const turn = await stopRecording(wrapper, socket)
    for (let i = 0; i < 2; i++) {
      message(socket, 'assistant.audio.start', turn, { segment: true })
      socket.handlers.message({ data: new ArrayBuffer(44) })
      message(socket, 'assistant.audio.end', turn, { segment: true })
    }
    await flushPromises()
    const staleEnded = audios[0].onended
    audios[0].onerror?.()
    staleEnded?.()
    await flushPromises()
    expect(audios).toHaveLength(1)
    expect(sent(socket).some(event => event.type === 'assistant.cancel')).toBe(true)
    await record(wrapper)
    const nextTurn = await stopRecording(wrapper, socket)
    message(socket, 'assistant.audio.start', nextTurn, { segment: true })
    socket.handlers.message({ data: new ArrayBuffer(32 * 1024 * 1024) })
    message(socket, 'assistant.audio.end', nextTurn, { segment: true })
    await flushPromises()
    audios[1].onended?.()
    message(socket, 'assistant.audio.start', nextTurn, { segment: true })
    socket.handlers.message({ data: new ArrayBuffer(1) })
    await flushPromises()
    expect(wrapper.text()).toContain('超过 32 MiB')
    expect(wrapper.find('.live-state').text()).toBe('点击开始说话')
  })

  it('clears connection memory and subtitles only after the reset acknowledgement', async () => {
    const wrapper = render()
    const socket = await record(wrapper)
    const turn = await stopRecording(wrapper, socket)
    message(socket, 'asr.final', turn, { text: '记住蓝色' })
    message(socket, 'assistant.text.delta', turn, { text: '好的' })
    message(socket, 'turn.end', turn)
    await flushPromises()
    await wrapper.find('.reset-session').trigger('tap')
    expect(sent(socket).some(event => event.type === 'session.reset')).toBe(true)
    expect(wrapper.findAll('.dialogue-row').map(row => row.text()).join(' ')).toContain('记住蓝色')
    expect(wrapper.find('.voice-button').attributes('disabled')).toBeDefined()
    message(socket, 'session.reset')
    await flushPromises()
    expect(wrapper.findAll('.dialogue-row')).toHaveLength(0)
    expect(wrapper.text()).toContain('当前连接的会话记忆已清空')
    expect(wrapper.find('.voice-button').attributes('disabled')).toBeUndefined()
  })

  it('retains subtitles if session reset times out and allows retry', async () => {
    const wrapper = render()
    const socket = await record(wrapper)
    const turn = await stopRecording(wrapper, socket)
    message(socket, 'assistant.text.delta', turn, { text: '保留本轮字幕' })
    message(socket, 'turn.end', turn)
    await flushPromises()
    vi.useFakeTimers()
    try {
      await wrapper.find('.reset-session').trigger('tap')
      await vi.advanceTimersByTimeAsync(15000)
      expect(wrapper.text()).toContain('确认超时')
      expect(wrapper.text()).toContain('保留本轮字幕')
      expect(wrapper.find('.reset-session').attributes('disabled')).toBeUndefined()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('plays H5 Blob replies from an object URL and acknowledges Open-LLM playback', async () => {
    const wrapper = render()
    await wrapper.findAll('.provider-options .provider-option')[2].trigger('tap')
    const socket = await record(wrapper)
    const turn = await stopRecording(wrapper, socket)
    reply(socket, turn, new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }))
    await flushPromises()
    expect(audios).toHaveLength(1)
    expect(audios[0].src).toBe('blob:voice-reply')
    expect(audios[0].play).toHaveBeenCalledOnce()
    audios[0].onended?.()
    expect(sent(socket).filter(event => event.type === 'playback.complete')).toEqual([{ type: 'playback.complete', turn_id: turn }])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:voice-reply')
  })

  it('revokes reply URLs and ignores stale ended callbacks after interruption', async () => {
    const wrapper = render()
    await wrapper.findAll('.provider-options .provider-option')[2].trigger('tap')
    const socket = await record(wrapper)
    const turn = await stopRecording(wrapper, socket)
    reply(socket, turn)
    await flushPromises()
    const staleEnded = audios[0].onended
    await wrapper.find('.interrupt-button').trigger('tap')
    staleEnded?.()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:voice-reply')
    expect(audios[0].removeAttribute).toHaveBeenCalledWith('src')
    expect(audios[0].load).toHaveBeenCalledOnce()
    expect(sent(socket).filter(event => event.type === 'playback.complete')).toHaveLength(0)
  })

  it('stops capture on app hide and does not submit an interrupted turn', async () => {
    const wrapper = render()
    const socket = await record(wrapper)
    capture()
    hideState.handler?.()
    expect(tracks[0].stop).toHaveBeenCalledOnce()
    expect(sent(socket).some(event => event.type === 'input.end')).toBe(false)
    expect(sent(socket).some(event => event.type === 'input.cancel')).toBe(true)
  })

  it('stops capture when the H5 document becomes hidden', async () => {
    const wrapper = render()
    const socket = await record(wrapper)
    capture()
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(tracks[0].stop).toHaveBeenCalledOnce()
    expect(sent(socket).some(event => event.type === 'input.end')).toBe(false)
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })

  it('maps common H5 microphone failures to actionable Chinese messages', async () => {
    const cases = [
      ['NotAllowedError', '麦克风权限被拒绝'],
      ['NotFoundError', '未检测到可用麦克风'],
      ['NotReadableError', '可能被其他应用占用'],
    ]
    for (const [name, expected] of cases) {
      getUserMedia.mockRejectedValueOnce(new DOMException(name, name))
      const wrapper = render()
      await wrapper.find('.voice-button').trigger('tap')
      await flushPromises()
      sockets.at(-1)!.handlers.open()
      await flushPromises()
      expect(wrapper.text()).toContain(expected)
    }
  })

  it('releases a late microphone grant after page hide and ignores stale setup', async () => {
    let resolveMic: ((stream: MediaStream) => void) | undefined
    getUserMedia.mockImplementation(() => new Promise<MediaStream>((resolve) => {
      resolveMic = resolve
    }))
    const wrapper = render()
    await wrapper.find('.voice-button').trigger('tap')
    await flushPromises()
    const socket = sockets[0]
    socket.handlers.open()
    await flushPromises()
    hideState.handler?.()
    const track = { stop: vi.fn() }
    resolveMic?.({ getTracks: () => [track] } as unknown as MediaStream)
    await flushPromises()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(processors).toHaveLength(0)
  })

  it('cleans microphone tracks on unmount and ignores late socket callbacks', async () => {
    const wrapper = render()
    const socket = await record(wrapper)
    wrapper.unmount()
    capture()
    expect(tracks[0].stop).toHaveBeenCalledOnce()
    message(socket, 'assistant.audio.start', 'stale-turn')
    expect(audios).toHaveLength(0)
    expect(sent(socket).some(event => event.type === 'input.end')).toBe(false)
  })
})
