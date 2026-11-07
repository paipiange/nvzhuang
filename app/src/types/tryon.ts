export type TryonStatus
  = | 'idle'
    | 'uploading'
    | 'queued'
    | 'processing'
    | 'success'
    | 'failed'
    | 'cancelled'

export type TryonSize = '1024x1024' | '1024x1536' | '1536x1024'

export interface TryonDraft {
  garmentId: string | null
  garmentImageUrl: string | null
  garmentTitle: string | null
  personLocalPath: string | null
  personFileId: string | null
  selectedPortraitId: string | null
  selectedPortraitUrl: string | null
  modelKey: string
  size: TryonSize
  keepFace: boolean
}

export interface TryonJob {
  id: string
  client_request_id?: string
  status: Exclude<TryonStatus, 'idle' | 'uploading'>
  progress?: number
  garment_id: string
  garment_image_url?: string
  person_image_url?: string
  result_url?: string
  result_b64?: string
  mime?: string
  model: string
  error_code?: string
  error_message?: string
  created_at: string
  completed_at?: string
}

export interface ModelOption {
  key: string
  name: string
  icon: string
  desc: string
  badge?: string
  enabled: boolean
}
