import { computed, readonly, ref } from 'vue'

export function useCallQuality() {
  const startedAt = ref(0)
  const durationSeconds = ref(0)
  const reconnects = ref(0)
  const congestionEvents = ref(0)
  let timer: ReturnType<typeof setInterval> | undefined

  const grade = computed<'良好' | '一般' | '较差'>(() => {
    if (reconnects.value >= 3 || congestionEvents.value >= 5)
      return '较差'
    if (reconnects.value || congestionEvents.value >= 2)
      return '一般'
    return '良好'
  })

  function updateDuration() {
    if (startedAt.value)
      durationSeconds.value = Math.max(0, Math.floor((Date.now() - startedAt.value) / 1000))
  }

  function start() {
    if (startedAt.value)
      return
    startedAt.value = Date.now()
    timer = setInterval(updateDuration, 1000)
  }

  function stop() {
    updateDuration()
    if (timer)
      clearInterval(timer)
    timer = undefined
    startedAt.value = 0
  }

  function reset() {
    stop()
    durationSeconds.value = 0
    reconnects.value = 0
    congestionEvents.value = 0
  }

  function noteReconnect() {
    reconnects.value++
  }

  function noteCongestion() {
    congestionEvents.value++
  }

  return {
    durationSeconds: readonly(durationSeconds),
    reconnects: readonly(reconnects),
    congestionEvents: readonly(congestionEvents),
    grade,
    start,
    stop,
    reset,
    noteReconnect,
    noteCongestion,
  }
}
