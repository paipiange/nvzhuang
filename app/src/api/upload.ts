import type { UploadResult } from '@/types/api'
import { useSettingsStore } from '@/store/settings'
import { getCurrentBaseUrl } from '@/utils'

export async function uploadImageFile(filePath: string): Promise<UploadResult> {
  const settings = useSettingsStore()

  if (settings.useMock) {
    return {
      file_id: `mock-upload-${Date.now()}`,
      url: filePath,
      mime: 'image/jpeg',
      size: 102400,
    }
  }

  const activeBaseUrl = (settings.serverBaseUrl?.trim() || getCurrentBaseUrl()).replace(/\/+$/, '')

  return new Promise((resolve, reject) => {
    uni.uploadFile({
      url: `${activeBaseUrl}/api/v1/uploads`,
      filePath,
      name: 'file',
      header: {
        'Accept': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
      success: (uploadRes) => {
        try {
          const res = JSON.parse(uploadRes.data)
          if (res.code === 0 && res.data) {
            resolve(res.data)
          }
          else {
            reject(new Error(res.message || '上传图片失败'))
          }
        }
        catch (e) {
          reject(new Error('上传响应解析失败'))
        }
      },
      fail: (err) => {
        reject(err)
      },
    })
  })
}
