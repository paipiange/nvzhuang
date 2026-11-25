import { computed, getCurrentScope, onScopeDispose, readonly, shallowRef } from 'vue'

export interface PortraitQueueTask<P> {
  id: string
  createdAt: number
  payload: P
  retryOf?: string
}

export interface PortraitQueueHistory<P, T> extends PortraitQueueTask<P> {
  completedAt: number
  status: 'success' | 'failed' | 'cancelled'
  result?: T
}

export function usePortraitQueue<P, T>(run: (payload: Readonly<P>) => Promise<T | undefined>, cancelActive: () => void, maxTasks = 3, maxResults = 2) {
  const waiting = shallowRef<PortraitQueueTask<P>[]>([])
  const active = shallowRef<PortraitQueueTask<P>>()
  const history = shallowRef<PortraitQueueHistory<P, T>[]>([])
  const cancelled = new Set<string>()
  let sequence = 0

  const size = computed(() => waiting.value.length + (active.value ? 1 : 0))
  const full = computed(() => size.value >= maxTasks)

  async function pump() {
    if (active.value || waiting.value.length === 0)
      return
    const [next, ...rest] = waiting.value
    waiting.value = rest
    active.value = next
    let status: PortraitQueueHistory<P, T>['status'] = 'failed'
    let result: T | undefined
    try {
      result = await run(next.payload)
      status = result === undefined ? 'failed' : 'success'
    }
    catch {
      status = 'failed'
    }
    finally {
      if (cancelled.delete(next.id))
        status = 'cancelled'
      const updated = [{ ...next, status, completedAt: Date.now(), ...(status === 'success' && result !== undefined ? { result } : {}) }, ...history.value].slice(0, 10)
      let keptResults = 0
      history.value = updated.map((item) => {
        if (item.result === undefined || ++keptResults <= maxResults)
          return item
        const { result: _, ...withoutResult } = item
        return withoutResult
      })
      if (active.value?.id === next.id)
        active.value = undefined
      void pump()
    }
  }

  function enqueue(payload: P, retryOf?: string) {
    if (full.value)
      return undefined
    const createdAt = Date.now()
    const task = { id: `portrait-${createdAt}-${++sequence}`, createdAt, payload, retryOf }
    waiting.value = [...waiting.value, task]
    void pump()
    return task
  }

  function cancelAll() {
    const completedAt = Date.now()
    const cancelledWaiting = waiting.value.map(task => ({ ...task, status: 'cancelled' as const, completedAt }))
    if (cancelledWaiting.length)
      history.value = [...cancelledWaiting.reverse(), ...history.value].slice(0, 10)
    waiting.value = []
    if (active.value) {
      cancelled.add(active.value.id)
      cancelActive()
    }
  }

  function retry(taskId: string) {
    const previous = history.value.find(item => item.id === taskId)
    if (!previous || previous.status === 'success')
      return undefined
    return enqueue(previous.payload, taskId)
  }

  function clearHistory() {
    history.value = []
  }

  if (getCurrentScope())
    onScopeDispose(cancelAll)

  return {
    waiting: readonly(waiting),
    active: readonly(active),
    history: readonly(history),
    size,
    full,
    enqueue,
    retry,
    clearHistory,
    cancelAll,
  }
}
