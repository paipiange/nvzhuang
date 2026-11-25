import { describe, expect, it } from 'vitest'
import { createCallSessionSummary } from './callSessionSummary'

describe('callSessionSummary', () => {
  it('formats bounded session counters without conversation or connection data', () => {
    const summary = createCallSessionSummary({
      characterName: '知夏',
      provider: 'seeduplex',
      durationSeconds: 65.9,
      turns: 4,
      interrupts: 1,
      mutedSeconds: 8,
      qualityGrade: '良好',
    })

    expect(summary).toContain('豆包 SeedDuplex')
    expect(summary).toContain('通话时长：65 秒')
    expect(summary).toContain('完成回合：4 次')
    expect(summary).not.toContain('api_key')
    expect(summary).not.toContain('wss://')
  })
})
