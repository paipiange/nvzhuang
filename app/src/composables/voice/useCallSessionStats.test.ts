import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCallSessionStats } from './useCallSessionStats'

afterEach(() => {
  vi.useRealTimers()
})

describe('useCallSessionStats', () => {
  it('tracks connected segments, turns, interruptions and accumulated mute time in memory', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-22T00:00:00.000Z'))
    const stats = useCallSessionStats()

    stats.start()
    vi.advanceTimersByTime(2500)
    stats.noteTurn()
    stats.noteTurn()
    stats.noteInterrupt()
    expect(stats.setMuted(true)).toBe(true)
    vi.advanceTimersByTime(3200)
    expect(stats.setMuted(false)).toBe(true)
    stats.stop()

    expect(stats.durationSeconds.value).toBe(5)
    expect(stats.turns.value).toBe(2)
    expect(stats.interrupts.value).toBe(1)
    expect(stats.mutedSeconds.value).toBe(3)

    stats.start()
    vi.advanceTimersByTime(1000)
    stats.stop()
    expect(stats.durationSeconds.value).toBe(6)
  })

  it('ignores inactive mutations and resets every current-run counter', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-22T00:00:00.000Z'))
    const stats = useCallSessionStats()

    expect(stats.setMuted(true)).toBe(false)
    stats.noteTurn()
    stats.noteInterrupt()
    stats.start()
    vi.advanceTimersByTime(1200)
    stats.setMuted(true)
    vi.advanceTimersByTime(1200)
    stats.reset()

    expect(stats.durationSeconds.value).toBe(0)
    expect(stats.turns.value).toBe(0)
    expect(stats.interrupts.value).toBe(0)
    expect(stats.mutedSeconds.value).toBe(0)
    expect(stats.running.value).toBe(false)
    expect(stats.muted.value).toBe(false)
  })
})
