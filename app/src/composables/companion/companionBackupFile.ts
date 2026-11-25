export const MAX_COMPANION_BACKUP_FILE_BYTES = 1024 * 1024
const BACKUP_FILE_PICKER_TIMEOUT_MS = 2 * 60 * 1000

export class CompanionBackupFileCancelledError extends Error {
  constructor() {
    super('未选择备份文件。')
    this.name = 'CompanionBackupFileCancelledError'
  }
}

export function isCompanionBackupFileCancelled(cause: unknown) {
  return cause instanceof CompanionBackupFileCancelledError
}

export function companionBackupFilename(now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  return `nvzhuang-companion-backup_${stamp}.json`
}

export function validateCompanionBackupFile(name: string, size: number, content: string) {
  if (!name.toLocaleLowerCase().endsWith('.json'))
    throw new Error('请选择 JSON 备份文件。')
  if (!Number.isFinite(size) || size <= 0 || size > MAX_COMPANION_BACKUP_FILE_BYTES)
    throw new Error('备份文件为空或超过 1 MB。')
  const contentBytes = typeof TextEncoder === 'function' ? new TextEncoder().encode(content).byteLength : content.length * 2
  if (!content || contentBytes > MAX_COMPANION_BACKUP_FILE_BYTES)
    throw new Error('备份文件为空或超过 1 MB。')
  return content
}

export function downloadCompanionBackupFile(content: string, now = new Date()) {
  const filename = companionBackupFilename(now)
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  validateCompanionBackupFile(filename, blob.size, content)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
  return filename
}

export function chooseCompanionBackupFile() {
  return new Promise<string>((resolve, reject) => {
    const input = document.createElement('input')
    let settled = false
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.style.display = 'none'
    let timeout: number | undefined
    function cleanup() {
      if (timeout !== undefined)
        window.clearTimeout(timeout)
      window.removeEventListener('focus', onWindowFocus)
      input.remove()
    }
    function finish(callback: () => void) {
      if (settled)
        return
      settled = true
      cleanup()
      callback()
    }
    function cancel() {
      finish(() => reject(new CompanionBackupFileCancelledError()))
    }
    function onWindowFocus() {
      window.setTimeout(() => {
        if (!input.files?.length)
          cancel()
      })
    }
    timeout = window.setTimeout(cancel, BACKUP_FILE_PICKER_TIMEOUT_MS)
    input.addEventListener('cancel', cancel, { once: true })
    input.addEventListener('change', async () => {
      const file = input.files?.[0]
      if (!file) {
        cancel()
        return
      }
      try {
        const content = validateCompanionBackupFile(file.name, file.size, await file.text())
        finish(() => resolve(content))
      }
      catch (cause) {
        finish(() => reject(cause))
      }
    }, { once: true })
    window.addEventListener('focus', onWindowFocus)
    document.body.appendChild(input)
    input.click()
  })
}
