export interface NativeAudioBridge {
  supportsDuplex: () => boolean
  startCapture: (sessionId: string) => void
  stopCapture: () => void
  beginPlayback: (playbackId: string) => void
  pushPlayback: (playbackId: string, pcm: string) => void
  endPlayback: (playbackId: string) => void
  clearPlayback: () => void
  dispose: () => void
}
export interface NativeAudioEvent {
  type: string
  sessionId?: string
  playbackId?: string
  pcm?: string
  rms?: number
  peak?: number
  code?: string
}
interface NativeAudioMessagePort {
  postMessage: (message: string) => void
  onmessage: ((event: MessageEvent<string>) => void) | null
}
let sequence = 0
let messagePort: NativeAudioMessagePort | undefined
let messageBridge: NativeAudioBridge | undefined
export function audioGeneration(prefix: string) {
  return `${prefix}-${Date.now()}-${++sequence}`
}
export function getNativeAudioBridge(): NativeAudioBridge | undefined {
  if (typeof window === 'undefined')
    return undefined
  const host = window as Window & { CompanionAudio?: NativeAudioBridge, CompanionAudioNative?: NativeAudioMessagePort }
  const bridge = host.CompanionAudio
  try {
    if (bridge?.supportsDuplex())
      return bridge
  }
  catch { /* Fall through to the Android message port adapter. */ }
  const port = host.CompanionAudioNative
  if (!port || typeof port.postMessage !== 'function')
    return undefined
  if (messagePort === port && messageBridge)
    return messageBridge
  const post = (type: string, detail: Record<string, string> = {}) => port.postMessage(JSON.stringify({ type, ...detail }))
  port.onmessage = ({ data }) => {
    if (typeof data !== 'string' || data.length > 96 * 1024)
      return
    try {
      const detail: unknown = JSON.parse(data)
      if (detail && typeof detail === 'object' && 'type' in detail && typeof detail.type === 'string')
        window.dispatchEvent(new CustomEvent('companion-audio', { detail }))
    }
    catch { /* Ignore malformed native events. */ }
  }
  messagePort = port
  messageBridge = {
    supportsDuplex: () => true,
    startCapture: sessionId => post('startCapture', { id: sessionId }),
    stopCapture: () => post('stopCapture', { id: audioGeneration('stop') }),
    beginPlayback: playbackId => post('beginPlayback', { id: playbackId }),
    pushPlayback: (playbackId, pcm) => post('pushPlayback', { id: playbackId, pcm }),
    endPlayback: playbackId => post('endPlayback', { id: playbackId }),
    clearPlayback: () => post('clearPlayback', { id: audioGeneration('clear') }),
    dispose: () => post('dispose', { id: audioGeneration('dispose') }),
  }
  return messageBridge
}
export function listenNativeAudio(handler: (event: NativeAudioEvent) => void) {
  const listener = (event: Event) => {
    const detail: unknown = (event as CustomEvent).detail
    if (!detail || typeof detail !== 'object' || !('type' in detail) || typeof detail.type !== 'string')
      return
    const value = detail as Record<string, unknown>
    if (['sessionId', 'playbackId', 'pcm', 'code'].some(key => value[key] !== undefined && typeof value[key] !== 'string'))
      return
    handler(value as unknown as NativeAudioEvent)
  }
  window.addEventListener('companion-audio', listener)
  return () => window.removeEventListener('companion-audio', listener)
}
export function pcmToBase64(pcm: ArrayBuffer) {
  const bytes = new Uint8Array(pcm)
  let output = ''
  for (let index = 0; index < bytes.length; index += 8192)
    output += String.fromCharCode(...bytes.subarray(index, index + 8192))
  return btoa(output)
}
export function pcmFromBase64(value: string) {
  if (value.length !== 856 || !/^[A-Z\d+/]+={0,2}$/i.test(value))
    throw new Error('invalid_audio_frame')
  const decoded = atob(value)
  if (decoded.length !== 640)
    throw new Error('invalid_audio_frame')
  return Uint8Array.from(decoded, character => character.charCodeAt(0)).buffer
}
