import { readonly, ref } from 'vue'

export function useCallSessionStats() {
  const durationSeconds = ref(0)
  const turns = ref(0)
  const interrupts = ref(0)
  const mutedSeconds = ref(0)
  const running = ref(false)
  const muted = ref(false)
  let elapsedMs = 0
  let mutedMs = 0
  let startedAt = 0
  let mutedAt = 0
  let timer: ReturnType<typeof setInterval> | undefined

  function refresh(now = Date.now()) {
    durationSeconds.value = Math.max(0, Math.floor((elapsedMs + (running.value ? now - startedAt : 0)) / 1000))
    mutedSeconds.value = Math.max(0, Math.floor((mutedMs + (muted.value ? now - mutedAt : 0)) / 1000))
  }

  function start() {
    if (running.value)
      return
    startedAt = Date.now()
    running.value = true
    timer = setInterval(() => refresh(), 250)
  }

  function setMuted(value: boolean) {
    if (!running.value)
      return false
    if (muted.value === value)
      return true
    const now = Date.now()
    if (value) {
      mutedAt = now
    }
    else {
      mutedMs += Math.max(0, now - mutedAt)
      mutedAt = 0
    }
    muted.value = value
    refresh(now)
    return true
  }

  function stop() {
    if (!running.value)
      return
    const now = Date.now()
    if (muted.value) {
      mutedMs += Math.max(0, now - mutedAt)
      mutedAt = 0
      muted.value = false
    }
    elapsedMs += Math.max(0, now - startedAt)
    startedAt = 0
    running.value = false
    if (timer)
      clearInterval(timer)
    timer = undefined
    refresh(now)
  }

  function reset() {
    stop()
    elapsedMs = 0
    mutedMs = 0
    durationSeconds.value = 0
    mutedSeconds.value = 0
    turns.value = 0
    interrupts.value = 0
  }

  function noteTurn() {
    if (running.value)
      turns.value++
  }

  function noteInterrupt() {
    if (running.value)
      interrupts.value++
  }

  return {
    durationSeconds: readonly(durationSeconds),
    turns: readonly(turns),
    interrupts: readonly(interrupts),
    mutedSeconds: readonly(mutedSeconds),
    running: readonly(running),
    muted: readonly(muted),
    start,
    stop,
    reset,
    setMuted,
    noteTurn,
    noteInterrupt,
  }
}
