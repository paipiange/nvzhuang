import { MAX_PLAYER_SECONDS, OUTPUT_RATE } from './voiceProtocol'
import { audioGeneration, getNativeAudioBridge, listenNativeAudio, pcmToBase64 } from './nativeAudio'
import type { NativeAudioBridge } from './nativeAudio'

export function useStreamingPlayer(onComplete: (turn: string) => void, onLevel: (rms: number) => void = () => {}, onError: (code: string) => void = () => {}) {
  let context: AudioContext | undefined
  let nativeBridge: NativeAudioBridge | undefined
  let releaseNative: (() => void) | undefined
  let playbackId = ''
  let turn = ''
  let epoch = 0
  let nextTime = 0
  let ended = false
  let bytes = 0
  let outputDeviceId = ''
  const sources = new Set<AudioBufferSourceNode>()
  function clear() {
    epoch++
    nativeBridge?.clearPlayback()
    playbackId = ''
    for (const source of sources) {
      source.onended = null
      source.stop()
      source.disconnect()
    }
    sources.clear()
    nextTime = 0
    ended = false
    bytes = 0
    turn = ''
    onLevel(0)
  }
  async function prepare() {
    nativeBridge = getNativeAudioBridge()
    if (nativeBridge) {
      releaseNative?.()
      releaseNative = listenNativeAudio((event) => {
        if (!playbackId || event.playbackId !== playbackId)
          return
        if (event.type === 'playback.complete' && ended && turn) {
          const completed = turn
          playbackId = turn = ''
          onLevel(0)
          onComplete(completed)
        }
        else if (event.type === 'playback.error') {
          clear()
          onError(event.code || 'invalid_audio_frame')
        }
      })
      return
    }
    if (!context || context.state === 'closed')
      context = new AudioContext()
    const selectable = context as AudioContext & { setSinkId?: (sinkId: string) => Promise<void> }
    if (outputDeviceId && selectable.setSinkId)
      await selectable.setSinkId(outputDeviceId)
    await context.resume()
  }
  async function setOutputDevice(deviceId: string) {
    outputDeviceId = deviceId
    if (!context || context.state === 'closed')
      return
    const selectable = context as AudioContext & { setSinkId?: (sinkId: string) => Promise<void> }
    if (deviceId && !selectable.setSinkId)
      throw new Error('output_device_not_supported')
    if (selectable.setSinkId)
      await selectable.setSinkId(deviceId)
  }
  function begin(id: string, rate = OUTPUT_RATE, channels = 1) {
    if (!id || rate !== OUTPUT_RATE || channels !== 1)
      throw new Error('invalid_audio_frame')
    clear()
    turn = id
    if (nativeBridge) {
      playbackId = audioGeneration('playback')
      nativeBridge.beginPlayback(playbackId)
    }
  }
  function completeIfDrained() {
    if (ended && !sources.size && turn) {
      const completed = turn
      turn = ''
      onLevel(0)
      onComplete(completed)
    }
  }
  function push(id: string, pcm: ArrayBuffer) {
    if (id !== turn || !turn || ended)
      return false
    if ((!nativeBridge && (!context || context.state !== 'running')) || !pcm.byteLength || pcm.byteLength % 2 || pcm.byteLength > 256 * 1024)
      throw new Error('invalid_audio_frame')
    if (nativeBridge) {
      if (pcm.byteLength > 64 * 1024 || bytes + pcm.byteLength > 32 * 1024 * 1024)
        throw new Error('audio_backpressure')
      bytes += pcm.byteLength
      nativeBridge.pushPlayback(playbackId, pcmToBase64(pcm))
      const view = new DataView(pcm)
      let squared = 0
      for (let index = 0; index < pcm.byteLength; index += 2)
        squared += (view.getInt16(index, true) / 32768) ** 2
      onLevel(Math.sqrt(squared / (pcm.byteLength / 2)))
      return true
    }
    if (!context)
      throw new Error('invalid_audio_frame')
    const duration = pcm.byteLength / 2 / OUTPUT_RATE
    if (Math.max(0, nextTime - context.currentTime) + duration > MAX_PLAYER_SECONDS || bytes + pcm.byteLength > 32 * 1024 * 1024)
      throw new Error('audio_backpressure')
    bytes += pcm.byteLength
    const buffer = context.createBuffer(1, pcm.byteLength / 2, OUTPUT_RATE)
    const output = buffer.getChannelData(0)
    const view = new DataView(pcm)
    let squared = 0
    for (let i = 0; i < output.length; i++) {
      output[i] = view.getInt16(i * 2, true) / 32768
      squared += output[i] * output[i]
    }
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)
    const generation = epoch
    source.onended = () => {
      source.disconnect()
      sources.delete(source)
      if (generation === epoch)
        completeIfDrained()
    }
    sources.add(source)
    nextTime = Math.max(nextTime, context.currentTime + (sources.size === 1 ? 0.08 : 0))
    source.start(nextTime)
    nextTime += duration
    onLevel(Math.sqrt(squared / output.length))
    return true
  }
  function end(id: string) {
    if (turn === id) {
      ended = true
      if (nativeBridge)
        nativeBridge.endPlayback(playbackId)
      else
        completeIfDrained()
    }
  }
  function dispose() {
    clear()
    if (context && context.state !== 'closed')
      void context.close()
    context = undefined
    releaseNative?.()
    releaseNative = undefined
    nativeBridge = undefined
  }
  return { prepare, setOutputDevice, begin, push, end, clear, dispose }
}
