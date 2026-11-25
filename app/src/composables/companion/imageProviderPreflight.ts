interface ImageProviderHealthItem {
  alias: string
  configured: boolean
  reachable: boolean
}

function dataEnvelope(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined
  const envelope = value as { code?: unknown, data?: unknown }
  return envelope.code === 0 && envelope.data && typeof envelope.data === 'object'
    ? envelope.data as Record<string, unknown>
    : undefined
}

export function evaluateImageProviderPreflight(response: unknown) {
  const data = dataEnvelope(response)
  if (!data || data.generation_request_made !== false || !Array.isArray(data.providers))
    return { ok: false, ready: 0, total: 0, message: '图片模型自检响应结构异常，请确认后端版本。' }

  const providers = data.providers.filter((item): item is ImageProviderHealthItem => !!item
    && typeof item === 'object'
    && typeof (item as ImageProviderHealthItem).alias === 'string'
    && typeof (item as ImageProviderHealthItem).configured === 'boolean'
    && typeof (item as ImageProviderHealthItem).reachable === 'boolean')
  if (providers.length !== data.providers.length || providers.length === 0)
    return { ok: false, ready: 0, total: 0, message: '图片模型自检响应结构异常，请确认后端版本。' }

  const ready = providers.filter(item => item.configured && item.reachable).length
  const configured = providers.filter(item => item.configured).length
  return {
    ok: ready > 0,
    ready,
    total: providers.length,
    message: ready > 0
      ? `图片模型自检完成：${ready}/${providers.length} 个可用，${configured - ready} 个已配置但不可用；未发起图片生成或计费请求。`
      : `图片模型自检完成：0/${providers.length} 个可用，${configured} 个已配置但不可用；未发起图片生成或计费请求。`,
  }
}
