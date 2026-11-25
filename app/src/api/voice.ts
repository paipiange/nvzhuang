import type { CustomRequestOptions } from '@/http/types'
import { ref } from 'vue'
import { http } from '@/http/http'
import { useSettingsStore } from '@/store/settings'

export interface VoiceTodo {
  id: number
  code: string
  title: string
  completed: boolean
  sort: number
}
export interface TodoSummary {
  items: VoiceTodo[]
  completed: number
  total: number
  progress: number
}
export interface VoiceComponent {
  name: string
  url: string
  available: boolean
  message?: string
}
export interface VoiceModel {
  name: string
  path: string
  exists: boolean
  size: number
  progress: number
  message?: string
  missing_files?: string[]
}
export interface VoiceTask {
  action: string
  running: boolean
  success: boolean
  progress: number
  message: string
  started_at?: string
}
export interface VoiceTaskStatus {
  tasks: VoiceTask[]
  huggingface_token_configured: boolean
  modelscope_token_configured: boolean
  seeduplex_api_key_configured: boolean
}

function endpoint(url: string): string {
  const base = useSettingsStore().serverBaseUrl.replace(/\/+$/, '')
  return `${base}${url}`
}

function request<T>(options: CustomRequestOptions) {
  return http<T>({ ...options, url: endpoint(options.url) })
}

export function getVoiceTodos() {
  return request<TodoSummary>({ url: '/api/v1/voice/todos', method: 'GET' })
}

export function setVoiceTodo(id: number, completed: boolean) {
  return request<TodoSummary>({
    url: `/api/v1/voice/todos/${id}`,
    method: 'PUT',
    data: { completed },
  })
}

export function getVoiceStatus() {
  return request<VoiceStatus>({ url: '/api/v1/voice/status', method: 'GET' })
}

export interface VoiceStatus {
  components: VoiceComponent[]
  models: VoiceModel[]
  downloading: boolean
  download_progress: number
  message: string
}

export function getVoiceTasks() {
  return request<VoiceTaskStatus>({ url: '/api/v1/voice/tasks', method: 'GET' })
}

export function startVoiceTask(action: string) {
  return request<VoiceTaskStatus>({ url: `/api/v1/voice/tasks/${encodeURIComponent(action)}`, method: 'POST' })
}

export const voiceBusy = ref(false)
