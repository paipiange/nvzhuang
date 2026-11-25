import captureUrl from './worklets/pcm-capture.worklet.js?url'
import { FRAME_BYTES } from './voiceProtocol'
import { audioGeneration, getNativeAudioBridge, listenNativeAudio, pcmFromBase64 } from './nativeAudio'
import type { NativeAudioBridge } from './nativeAudio'
import type { CaptureDiagnostics } from './useVoiceOperations'

export interface CaptureFrame { pcm: ArrayBuffer, rms: number, peak: number }
export interface CaptureOptions {
  deviceId?: string
  onConfigured?: (diagnostics: CaptureDiagnostics) => void
}
export function supportsDuplexCapture() {
  if (getNativeAudioBridge())
    return true
  return typeof AudioContext !== 'undefined' && 'audioWorklet' in AudioContext.prototype && typeof AudioWorkletNode !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

export function usePcmCapture() {
  let epoch = 0
  let nativeBridge: NativeAudioBridge | undefined
  let releaseNative: (() => void) | undefined
  let cancelNativeStart: (() => void) | undefined
  let context: AudioContext | undefined
  let stream: MediaStream | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let node: AudioWorkletNode | undefined
  let mute: GainNode | undefined
  function stop() {
    epoch++
    cancelNativeStart?.()
    cancelNativeStart = undefined
    releaseNative?.()
    releaseNative = undefined
    nativeBridge?.stopCapture()
    nativeBridge = undefined
    if (node) {
      node.port.onmessage = null
      node.port.close()
      node.disconnect()
    }
    source?.disconnect()
    mute?.disconnect()
    stream?.getTracks().forEach((track) => {
      track.onended = null
      track.stop()
    })
    if (context && context.state !== 'closed')
      void context.close()
    node = undefined
    source = undefined
    mute = undefined
    context = undefined
    stream = undefined
  }
  async function start(onFrame: (frame: CaptureFrame) => void, onEnded: () => void, options: CaptureOptions = {}) {
    stop()
    if (!supportsDuplexCapture())
      throw new Error('duplex_not_supported')
    const generation = epoch
    const bridge = getNativeAudioBridge()
    if (bridge) {
      nativeBridge = bridge
      const sessionId = audioGeneration('capture')
      return new Promise<boolean>((resolve, reject) => {
        let started = false
        const timeout = setTimeout(() => {
          if (generation === epoch) {
            cancelNativeStart = undefined
            stop()
            reject(new Error('microphone_denied'))
          }
        }, 30000)
        cancelNativeStart = () => {
          clearTimeout(timeout)
          resolve(false)
        }
        releaseNative = listenNativeAudio((event) => {
          if (generation !== epoch || event.sessionId !== sessionId)
            return
          if (event.type === 'capture.started') {
            started = true
            clearTimeout(timeout)
            cancelNativeStart = undefined
            options.onConfigured?.({ deviceLabel: 'Android 原生麦克风', native: true })
            resolve(true)
          }
          else if (event.type === 'capture.frame' && started && event.pcm && Number.isFinite(event.rms) && Number.isFinite(event.peak)) {
            try {
              onFrame({ pcm: pcmFromBase64(event.pcm), rms: event.rms!, peak: event.peak! })
            }
            catch {
              onEnded()
            }
          }
          else if (event.type === 'capture.error') {
            clearTimeout(timeout)
            if (started) {
              onEnded()
            }
            else {
              cancelNativeStart = undefined
              stop()
              reject(new Error(event.code === 'duplex_not_supported' ? event.code : 'microphone_denied'))
            }
          }
        })
        try {
          bridge.startCapture(sessionId)
        }
        catch {
          cancelNativeStart = undefined
          clearTimeout(timeout)
          stop()
          reject(new Error('duplex_not_supported'))
        }
      })
    }
    const activeContext = new AudioContext()
    context = activeContext
    try {
      // Resume during the user gesture, before awaiting permission/network.
      await activeContext.resume()
      if (generation !== epoch)
        return false
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
        },
      })
      if (generation !== epoch) {
        media.getTracks().forEach(track => track.stop())
        return false
      }
      stream = media
      const track = media.getAudioTracks()[0]
      const settings = track?.getSettings?.() || {}
      options.onConfigured?.({
        deviceLabel: track?.label?.replace(/[\r\n\t]/g, ' ').trim().slice(0, 80) || '默认麦克风',
        echoCancellation: settings.echoCancellation,
        noiseSuppression: settings.noiseSuppression,
        autoGainControl: settings.autoGainControl,
      })
      media.getTracks().forEach((track) => {
        track.onended = onEnded
      })
      await activeContext.audioWorklet.addModule(captureUrl)
      if (generation !== epoch)
        return false
      source = activeContext.createMediaStreamSource(media)
      node = new AudioWorkletNode(activeContext, 'pcm-capture')
      mute = activeContext.createGain()
      mute.gain.value = 0
      node.port.onmessage = ({ data }: MessageEvent<CaptureFrame>) => {
        if (generation === epoch && data.pcm instanceof ArrayBuffer && data.pcm.byteLength === FRAME_BYTES && Number.isFinite(data.rms) && Number.isFinite(data.peak))
          onFrame(data)
      }
      source.connect(node)
      node.connect(mute)
      mute.connect(activeContext.destination)
      return true
    }
    catch (error) {
      if (generation === epoch)
        stop()
      throw error
    }
  }
  return { start, stop }
}
