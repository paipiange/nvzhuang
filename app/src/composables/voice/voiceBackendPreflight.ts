function dataEnvelope(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined
  const envelope = value as { code?: unknown, data?: unknown }
  return envelope.code === 0 && envelope.data && typeof envelope.data === 'object' ? envelope.data as Record<string, unknown> : undefined
}

export function evaluateVoiceBackendPreflight(statusResponse: unknown, tasksResponse: unknown, hasRuntimeKey = false) {
  const status = dataEnvelope(statusResponse)
  const tasks = dataEnvelope(tasksResponse)
  if (!status || !Array.isArray(status.components) || !Array.isArray(status.models) || !tasks || typeof tasks.seeduplex_api_key_configured !== 'boolean')
    return { ok: false, configured: false, message: '语音接口响应结构异常，请确认后端版本。' }
  const configured = hasRuntimeKey || tasks.seeduplex_api_key_configured
  return {
    ok: true,
    configured,
    message: configured
      ? '语音后端自检通过，SeedDuplex Key 已配置。'
      : '语音后端自检通过；未检测到 SeedDuplex Key，可填写本次运行 Key 或配置后端环境变量。',
  }
}
