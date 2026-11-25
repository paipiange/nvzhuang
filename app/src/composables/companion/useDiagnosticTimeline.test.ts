import { describe, expect, it } from 'vitest'
import { useDiagnosticTimeline } from './useDiagnosticTimeline'

describe('useDiagnosticTimeline', () => {
  it('keeps newest bounded status-only entries', () => {
    const timeline = useDiagnosticTimeline(2)
    timeline.add('session.ready', {}, 100)
    timeline.add('turn.started', { value: 3 }, 200)
    timeline.add('turn.completed', { code: 'ok' }, 300)
    expect(timeline.entries.value).toEqual([
      { id: 3, at: 300, type: 'turn.completed', code: 'ok' },
      { id: 2, at: 200, type: 'turn.started', value: 3 },
    ])
  })

  it('normalizes arbitrary private strings and clears memory', () => {
    const timeline = useDiagnosticTimeline()
    timeline.add('private conversation', { code: 'https://private.invalid/?token=secret' })
    expect(JSON.stringify(timeline.entries.value)).not.toMatch(/conversation|private\.invalid|secret/)
    expect(timeline.entries.value[0]).toMatchObject({ type: 'unknown', code: 'unknown' })
    timeline.clear()
    expect(timeline.entries.value).toEqual([])
  })
})
