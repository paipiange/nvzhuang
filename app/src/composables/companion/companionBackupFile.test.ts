import { afterEach, describe, expect, it, vi } from 'vitest'
import { chooseCompanionBackupFile, companionBackupFilename, downloadCompanionBackupFile, isCompanionBackupFileCancelled, MAX_COMPANION_BACKUP_FILE_BYTES, validateCompanionBackupFile } from './companionBackupFile'

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

describe('companionBackupFile', () => {
  it('creates a portable filename without a local absolute path', () => {
    expect(companionBackupFilename(new Date('2026-11-22T12:34:56.789Z'))).toBe('nvzhuang-companion-backup_2026-11-22_12-34-56-789.json')
  })

  it('accepts bounded JSON files and rejects other extensions or oversized content', () => {
    expect(validateCompanionBackupFile('backup.json', 2, '{}')).toBe('{}')
    expect(() => validateCompanionBackupFile('backup.txt', 2, '{}')).toThrow('JSON')
    expect(() => validateCompanionBackupFile('backup.json', MAX_COMPANION_BACKUP_FILE_BYTES + 1, '{}')).toThrow('1 MB')
  })

  it('downloads a local JSON blob and revokes its temporary URL', () => {
    const click = vi.fn()
    const anchor = document.createElement('a')
    anchor.click = click
    vi.spyOn(document, 'createElement').mockReturnValueOnce(anchor)
    const createObjectURL = vi.fn(() => 'blob:companion-backup')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })

    const filename = downloadCompanionBackupFile('{}', new Date('2026-11-22T00:00:00.000Z'))

    expect(filename).toBe('nvzhuang-companion-backup_2026-11-22_00-00-00-000.json')
    expect(anchor.download).toBe(filename)
    expect(anchor.href).toContain('blob:companion-backup')
    expect(click).toHaveBeenCalledOnce()
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:companion-backup')
  })

  it('settles and cleans up when the native file picker is cancelled', async () => {
    const input = document.createElement('input')
    input.click = vi.fn()
    vi.spyOn(document, 'createElement').mockReturnValueOnce(input)

    const selection = chooseCompanionBackupFile()
    expect(input.isConnected).toBe(true)
    input.dispatchEvent(new Event('cancel'))

    await expect(selection).rejects.toSatisfy(isCompanionBackupFileCancelled)
    expect(input.isConnected).toBe(false)
  })
})
