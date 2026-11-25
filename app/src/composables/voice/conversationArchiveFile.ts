export type ConversationArchiveScope = 'all' | 'favorites'

export function conversationArchiveFilename(scope: ConversationArchiveScope, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  return `nvzhuang-conversations-${scope}_${stamp}.json`
}

export function downloadConversationArchiveFile(content: string, scope: ConversationArchiveScope, now = new Date()) {
  const filename = conversationArchiveFilename(scope, now)
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
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
