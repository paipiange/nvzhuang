export function requiresCloudCostAcknowledgement(modelKey: string, useMock = false) {
  return !useMock && !modelKey.trim().toLowerCase().startsWith('comfyui')
}

export function confirmCloudCost(message = '本次将调用云端图像模型，可能消耗账号额度。是否继续？') {
  return new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '确认云端生成',
      content: message,
      confirmText: '确认生成',
      cancelText: '取消',
      success: result => resolve(result.confirm === true),
      fail: () => resolve(false),
    })
  })
}
