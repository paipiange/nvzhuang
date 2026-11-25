import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_TITLE, resolveAppTitle } from './appMetadata'

describe('app metadata', () => {
  it('uses the configured title after trimming whitespace', () => {
    expect(resolveAppTitle('  AI 陪伴试衣  ')).toBe('AI 陪伴试衣')
  })

  it('uses a safe title when no env file is installed', () => {
    expect(resolveAppTitle()).toBe(DEFAULT_APP_TITLE)
    expect(resolveAppTitle('   ')).toBe(DEFAULT_APP_TITLE)
  })
})
