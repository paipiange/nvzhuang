import { afterEach, describe, expect, it, vi } from 'vitest'
import { conversationArchiveFilename, downloadConversationArchiveFile } from './conversationArchiveFile'

const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')

afterEach(() => {
  vi.restoreAllMocks()
  if (originalCreateObjectURL)
    Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL)
  else
    Reflect.deleteProperty(URL, 'createObjectURL')
  if (originalRevokeObjectURL)
    Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURL)
  else
    Reflect.deleteProperty(URL, 'revokeObjectURL')
})

describe('conversationArchiveFile', () => {
  it('creates a portable filename for each export scope', () => {
    const now = new Date('2026-11-23T00:00:00.000Z')
    expect(conversationArchiveFilename('all', now)).toBe('nvzhuang-conversations-all_2026-11-23_00-00-00-000.json')
    expect(conversationArchiveFilename('favorites', now)).toContain('conversations-favorites_')
  })

  it('downloads JSON through a temporary object URL and revokes it', () => {
    const anchor = document.createElement('a')
    anchor.click = vi.fn()
    vi.spyOn(document, 'createElement').mockReturnValueOnce(anchor)
    const createObjectURL = vi.fn(() => 'blob:conversation-archive')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })

    const filename = downloadConversationArchiveFile('{"version":2}', 'all', new Date('2026-11-23T00:00:00.000Z'))
    expect(anchor.download).toBe(filename)
    expect(anchor.click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:conversation-archive')
  })
})
