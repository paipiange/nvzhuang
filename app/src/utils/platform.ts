/**
 * 跨端能力适配工具 (微信小程序 / Android App / H5)
 */

export const isH5 = typeof window !== 'undefined' && !('plus' in (globalThis as any)) && !('wx' in (globalThis as any))
let _isMpWeixin = false
// #ifdef MP-WEIXIN
_isMpWeixin = true
// #endif
export const isMpWeixin = _isMpWeixin

let _isApp = false
// #ifdef APP-PLUS
_isApp = true
// #endif
export const isApp = _isApp

export function showToast(title: string, icon: 'none' | 'success' | 'error' = 'none') {
  uni.showToast({
    title,
    icon,
    duration: 2000,
  })
}

/**
 * 跨端选择人像照片
 */
export async function choosePersonImage(): Promise<string | null> {
  return new Promise((resolve) => {
    // #ifdef MP-WEIXIN
    if (uni.chooseMedia) {
      uni.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        camera: 'front',
        success: (res) => {
          if (res.tempFiles && res.tempFiles.length > 0) {
            resolve(res.tempFiles[0].tempFilePath)
          }
          else {
            resolve(null)
          }
        },
        fail: (err) => {
          console.warn('chooseMedia canceled or failed:', err)
          resolve(null)
        },
      })
      return
    }
    // #endif

    uni.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        if (res.tempFilePaths && res.tempFilePaths.length > 0) {
          resolve(res.tempFilePaths[0])
        }
        else {
          resolve(null)
        }
      },
      fail: (err) => {
        console.warn('chooseImage canceled or failed:', err)
        resolve(null)
      },
    })
  })
}

/**
 * 跨端保存图片到相册或本地
 */
export async function saveImageToAlbum(imageUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    // #ifdef H5
    try {
      const a = document.createElement('a')
      a.href = imageUrl
      a.download = `tryon_${Date.now()}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      showToast('图片下载已触发', 'success')
      resolve(true)
    }
    catch (e) {
      showToast('请长按图片保存到相册')
      resolve(false)
    }
    return
    // #endif

    // 小程序与 App 端：如果是网络图片，先下载为临时文件再写入相册
    const doSave = (filePath: string) => {
      uni.saveImageToPhotosAlbum({
        filePath,
        success: () => {
          showToast('已保存到手机相册', 'success')
          resolve(true)
        },
        fail: (err) => {
          console.warn('saveImageToPhotosAlbum error', err)
          // #ifdef MP-WEIXIN
          if (err.errMsg && (err.errMsg.includes('auth deny') || err.errMsg.includes('auth denied'))) {
            uni.showModal({
              title: '提示',
              content: '需要相册写入权限才能保存图片，请在设置中开启',
              confirmText: '去设置',
              success: (modalRes) => {
                if (modalRes.confirm) {
                  uni.openSetting({})
                }
              },
            })
          }
          else {
            showToast('保存失败，请稍后重试')
          }
          // #endif
          // #ifndef MP-WEIXIN
          showToast('保存失败，请检查相册权限')
          // #endif
          resolve(false)
        },
      })
    }

    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      uni.downloadFile({
        url: imageUrl,
        success: (downRes) => {
          if (downRes.statusCode === 200 && downRes.tempFilePath) {
            doSave(downRes.tempFilePath)
          }
          else {
            showToast('图片下载失败')
            resolve(false)
          }
        },
        fail: (err) => {
          console.error('downloadFile fail', err)
          showToast('图片下载失败，请检查网络')
          resolve(false)
        },
      })
    }
    else {
      // 本地临时文件直接保存
      doSave(imageUrl)
    }
  })
}

/**
 * 复制文本并给出友好提示
 */
export function copyToClipboard(text: string, tip = '已复制到剪贴板') {
  uni.setClipboardData({
    data: text,
    success: () => {
      showToast(tip, 'success')
    },
    fail: () => {
      showToast('复制失败')
    },
  })
}
