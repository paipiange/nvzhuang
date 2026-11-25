import type { VoiceProvider } from './useVoiceProviderPreference'

const PROVIDER_LABELS: Record<VoiceProvider, string> = {
  'local': '本地 Qwen',
  'seeduplex': '豆包 SeedDuplex',
  'open-llm-vtuber': 'Open-LLM-VTuber',
}

export interface CallSessionSummaryInput {
  characterName: string
  provider: VoiceProvider
  durationSeconds: number
  turns: number
  interrupts: number
  mutedSeconds: number
  qualityGrade: string
}

export function createCallSessionSummary(input: CallSessionSummaryInput) {
  return [
    'AI 陪伴通话摘要',
    `角色：${input.characterName}`,
    `引擎：${PROVIDER_LABELS[input.provider]}`,
    `通话时长：${Math.max(0, Math.trunc(input.durationSeconds))} 秒`,
    `完成回合：${Math.max(0, Math.trunc(input.turns))} 次`,
    `主动打断：${Math.max(0, Math.trunc(input.interrupts))} 次`,
    `静音时长：${Math.max(0, Math.trunc(input.mutedSeconds))} 秒`,
    `质量等级：${input.qualityGrade || '未评估'}`,
    '隐私说明：摘要不包含对话正文、音频、Key、端点和设备名称。',
  ].join('\n')
}
