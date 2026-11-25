import { describe, expect, it, vi } from 'vitest'
import { usePortraitQueue } from './usePortraitQueue'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('usePortraitQueue', () => {
  it('runs at most three queued portrait tasks serially', async () => {
    const first = deferred<string | undefined>()
    const second = deferred<string | undefined>()
    const run = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockResolvedValueOnce('third')
    const queue = usePortraitQueue<string, string>(run, vi.fn())

    expect(queue.enqueue('first')).toBeDefined()
    expect(queue.enqueue('second')).toBeDefined()
    expect(queue.enqueue('third')).toBeDefined()
    expect(queue.enqueue('fourth')).toBeUndefined()
    expect(queue.size.value).toBe(3)
    expect(run).toHaveBeenCalledTimes(1)

    first.resolve('first')
    await first.promise
    await Promise.resolve()
    expect(run).toHaveBeenCalledTimes(2)

    second.resolve('second')
    await second.promise
    await Promise.resolve()
    await Promise.resolve()
    expect(run).toHaveBeenCalledTimes(3)
    expect(queue.size.value).toBe(0)
    expect(queue.history.value.map(item => item.status)).toEqual(['success', 'success', 'success'])
    expect(queue.history.value.map(item => item.result)).toEqual(['third', 'second', undefined])
  })

  it('clears waiting tasks and cancels the active task', async () => {
    const current = deferred<undefined>()
    const cancel = vi.fn(() => current.resolve(undefined))
    const queue = usePortraitQueue<string, undefined>(() => current.promise, cancel)
    queue.enqueue('active')
    queue.enqueue('waiting')

    queue.cancelAll()
    expect(cancel).toHaveBeenCalledOnce()
    expect(queue.waiting.value).toEqual([])
    await current.promise
    await Promise.resolve()
    expect(queue.size.value).toBe(0)
    expect(queue.history.value.map(item => item.status)).toEqual(['cancelled', 'cancelled'])
  })

  it('keeps bounded task history and retries failed tasks only', async () => {
    const run = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce('ok')
    const queue = usePortraitQueue<string, string>(run, vi.fn())
    queue.enqueue('snapshot-a')
    await Promise.resolve()
    await Promise.resolve()

    const failed = queue.history.value[0]
    expect(failed.status).toBe('failed')
    expect(queue.retry(failed.id)).toMatchObject({ retryOf: failed.id, payload: 'snapshot-a' })
    await Promise.resolve()
    await Promise.resolve()
    expect(queue.history.value[0]).toMatchObject({ status: 'success', retryOf: failed.id })
    expect(queue.retry(queue.history.value[0].id)).toBeUndefined()
  })

  it('passes each task snapshot to the runner in queue order', async () => {
    const seen: Array<{ poseId: string }> = []
    const queue = usePortraitQueue<{ poseId: string }, string>(async (snapshot) => {
      seen.push(snapshot)
      return snapshot.poseId
    }, vi.fn())
    const first = { poseId: 'wave' }
    queue.enqueue({ ...first })
    first.poseId = 'sitting'
    queue.enqueue({ ...first })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(seen).toEqual([{ poseId: 'wave' }, { poseId: 'sitting' }])
  })

  it('clears in-memory result history without cancelling queued work', async () => {
    const current = deferred<string | undefined>()
    const queue = usePortraitQueue<string, string>(() => current.promise, vi.fn())
    queue.enqueue('snapshot')
    current.resolve('image')
    await current.promise
    await Promise.resolve()
    expect(queue.history.value[0].result).toBe('image')
    queue.clearHistory()
    expect(queue.history.value).toEqual([])
  })
})
