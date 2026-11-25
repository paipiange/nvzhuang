export interface ReadinessInput {
  online: boolean
  endpointValid: boolean
  captureSupported: boolean
  inputDetected: boolean
  providerConfigured: boolean
  microphoneTest: 'untested' | 'passed' | 'failed'
  speakerTest: 'untested' | 'passed' | 'failed'
}

export interface ReadinessCheck {
  key: keyof ReadinessInput
  label: string
  ok: boolean
  blocking: boolean
}

export function evaluateVoiceReadiness(input: ReadinessInput) {
  const audioTestLabel = (name: string, result: 'untested' | 'passed' | 'failed') => `${name}试音${result === 'passed' ? '已通过' : result === 'failed' ? '需检查' : '未执行'}`
  const checks: ReadinessCheck[] = [
    { key: 'online', label: '网络连接', ok: input.online, blocking: true },
    { key: 'endpointValid', label: '可信语音端点', ok: input.endpointValid, blocking: true },
    { key: 'captureSupported', label: '持续音频能力', ok: input.captureSupported, blocking: true },
    { key: 'inputDetected', label: '音频输入设备', ok: input.inputDetected, blocking: false },
    { key: 'providerConfigured', label: '语音服务配置', ok: input.providerConfigured, blocking: false },
    { key: 'microphoneTest', label: audioTestLabel('麦克风', input.microphoneTest), ok: input.microphoneTest === 'passed', blocking: false },
    { key: 'speakerTest', label: audioTestLabel('扬声器', input.speakerTest), ok: input.speakerTest === 'passed', blocking: false },
  ]
  return {
    checks,
    ready: checks.every(item => item.ok || !item.blocking),
    warningCount: checks.filter(item => !item.ok).length,
  }
}
