import type { TryonJob } from '@/types/tryon'
import type { TryonJobCreateReq } from '@/types/api'
import { http } from '@/http/http'
import { useSettingsStore } from '@/store/settings'

export async function createTryonJob(payload: TryonJobCreateReq): Promise<TryonJob> {
  const settings = useSettingsStore()

  if (settings.useMock) {
    // 模拟任务生成
    const mockJob: TryonJob = {
      id: `job-${Date.now()}`,
      client_request_id: payload.client_request_id,
      status: 'success',
      garment_id: payload.garment_id,
      model: payload.model_key,
      result_url: 'https://paipiange.github.io/nvzhuang/assets/thumbs/SPR-0001.webp',
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }
    return mockJob
  }

  const res = await http<TryonJob>({
    url: '/api/v1/tryon/jobs',
    method: 'POST',
    data: payload,
  })
  return res
}

export async function getTryonJob(jobId: string): Promise<TryonJob> {
  const settings = useSettingsStore()

  if (settings.useMock) {
    return {
      id: jobId,
      status: 'success',
      garment_id: 'real:SPR-0001',
      model: 'gemini',
      result_url: 'https://paipiange.github.io/nvzhuang/assets/thumbs/SPR-0001.webp',
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }
  }

  const res = await http<TryonJob>({
    url: `/api/v1/tryon/jobs/${encodeURIComponent(jobId)}`,
    method: 'GET',
  })
  return res
}

export async function deleteTryonHistoryApi(jobId: string): Promise<boolean> {
  const settings = useSettingsStore()
  if (settings.useMock)
    return true

  try {
    await http({
      url: `/api/v1/tryon/history/${encodeURIComponent(jobId)}`,
      method: 'DELETE',
    })
    return true
  }
  catch (e) {
    return false
  }
}
