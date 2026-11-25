const LOCAL_SERVICE_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '10.0.2.2'])

export function normalizeServiceBaseUrl(raw: string) {
  let url: URL
  try {
    url = new URL(raw.trim())
  }
  catch {
    throw new Error('服务地址格式无效。')
  }
  const local = LOCAL_SERVICE_HOSTS.has(url.hostname)
  if (!['http:', 'https:'].includes(url.protocol)
    || (url.protocol === 'http:' && !local)
    || url.username || url.password || url.search || url.hash) {
    throw new Error('远程服务必须使用 HTTPS，且地址不能包含凭据、查询参数或片段。')
  }
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url.href.replace(/\/$/, '')
}

export function normalizeModelBaseUrl(raw: string) {
  try {
    return normalizeServiceBaseUrl(raw)
  }
  catch {
    throw new Error('模型端点必须使用远程 HTTPS 或本机回环地址，且不能包含凭据、查询参数或片段。')
  }
}
