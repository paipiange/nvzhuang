export interface ApiResponse<T = any> {
  code: number
  message: string
  data: T
  request_id?: string
}

export interface GuestAuthResult {
  token: string
  guest_id: string
  daily_limit: number
  remaining: number
  expires_in: number
}

export interface UploadResult {
  file_id: string
  url: string
  mime: string
  size: number
}

export interface TryonJobCreateReq {
  garment_id: string
  person_file_id?: string
  portrait_id?: string
  model_key: string
  size: string
  keep_face: boolean
  client_request_id?: string
}
