export interface CompanionRestoreTransactionResult {
  ok: boolean
  error?: Error
  rollbackError?: Error
}

function asError(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause : new Error(fallback)
}

export function executeCompanionRestoreTransaction(apply: () => void, rollback: () => void): CompanionRestoreTransactionResult {
  try {
    apply()
    return { ok: true }
  }
  catch (cause) {
    const error = asError(cause, '陪伴备份恢复失败。')
    try {
      rollback()
      return { ok: false, error }
    }
    catch (rollbackCause) {
      return {
        ok: false,
        error,
        rollbackError: asError(rollbackCause, '陪伴备份回滚失败。'),
      }
    }
  }
}
