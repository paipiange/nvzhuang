<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { onHide, onLoad } from '@dcloudio/uni-app'
import { getVoiceStatus, getVoiceTasks, getVoiceTodos, setVoiceTodo, startVoiceTask } from '@/api/voice'
import type { TodoSummary, VoiceStatus, VoiceTaskStatus } from '@/api/voice'
import { useSettingsStore } from '@/store/settings'
import { validateVoiceEndpoint } from '@/composables/voice/voiceProtocol'
import { supportsDuplexCapture } from '@/composables/voice/usePcmCapture'
import { useDuplexSession } from '@/composables/voice/useDuplexSession'
import { useConversationArchive } from '@/composables/voice/conversationArchive'
import type { ConversationEntry } from '@/composables/voice/conversationArchive'
import { downloadConversationArchiveFile } from '@/composables/voice/conversationArchiveFile'
import type { ConversationArchiveScope } from '@/composables/voice/conversationArchiveFile'
import { useCallQuality } from '@/composables/voice/useCallQuality'
import { useCallSessionStats } from '@/composables/voice/useCallSessionStats'
import { createCallSessionSummary } from '@/composables/voice/callSessionSummary'
import { useTurnLatency } from '@/composables/voice/useTurnLatency'
import { useMicrophoneTest } from '@/composables/voice/useMicrophoneTest'
import { useSpeakerTest } from '@/composables/voice/useSpeakerTest'
import { useVoiceProviderPreference } from '@/composables/voice/useVoiceProviderPreference'
import type { VoiceProvider } from '@/composables/voice/useVoiceProviderPreference'
import { evaluateVoiceReadiness } from '@/composables/voice/voiceReadiness'
import { echoGuidance, useAudioInputDevices, useAudioOutputDevices, useReconnectController } from '@/composables/voice/useVoiceOperations'
import type { CaptureDiagnostics } from '@/composables/voice/useVoiceOperations'
import { useCharacter } from '@/composables/character/useCharacter'
import type { CharacterProfile, GeneratedPortrait } from '@/composables/character/useCharacter'
import { useCharacterPresets } from '@/composables/character/useCharacterPresets'
import type { CharacterPreset } from '@/composables/character/useCharacterPresets'
import { usePortraitQueue } from '@/composables/character/usePortraitQueue'
import { useCompanionPrivacy } from '@/composables/companion/useCompanionPrivacy'
import { createCompanionBackup, parseCompanionBackup, summarizeCompanionBackup } from '@/composables/companion/companionBackup'
import type { CompanionBackup } from '@/composables/companion/companionBackup'
import { chooseCompanionBackupFile, companionBackupFilename, downloadCompanionBackupFile, isCompanionBackupFileCancelled, validateCompanionBackupFile } from '@/composables/companion/companionBackupFile'
import { executeCompanionRestoreTransaction } from '@/composables/companion/companionRestoreTransaction'
import { createDiagnosticReport } from '@/composables/companion/diagnosticReport'
import { useDiagnosticTimeline } from '@/composables/companion/useDiagnosticTimeline'
import { confirmCloudCost } from '@/composables/companion/cloudCostGuard'
import { CHARACTERS, FACES, OUTFITS, POSES } from '@/composables/character/catalog'
import AvatarRenderer from '@/components/companion/AvatarRenderer.vue'

definePage({
  style: {
    navigationBarTitleText: 'AI 陪伴通话',
  },
})

const status = ref<VoiceStatus>()
const todos = ref<TodoSummary>()
const taskStatus = ref<VoiceTaskStatus>()
const taskBusy = ref<string | null>(null)
const loading = ref(false)
const error = ref('')
const updating = ref<number | null>(null)
const voiceProviderPreference = useVoiceProviderPreference()
const voiceProvider = voiceProviderPreference.provider
onLoad((options) => {
  if (options?.provider === 'seeduplex')
    voiceProviderPreference.select('seeduplex')
})
const voiceState = ref<'idle' | 'connecting' | 'recording' | 'processing' | 'playing'>('idle')
const transcript = ref('')
const answer = ref('')
const voiceError = ref('')
const settingsStore = useSettingsStore()
const character = useCharacter()
const { profile, face, outfit, portrait, assetError, portraitError } = character
const avatarToolAudit = character.toolAudit
const portraitQueue = usePortraitQueue<CharacterProfile, GeneratedPortrait>(snapshot => character.generatePortrait(snapshot, true), () => character.cancelPortrait())
const portraitGallery = computed(() => portraitQueue.history.value.flatMap(item => item.result ? [{ id: item.id, payload: item.payload, result: item.result, completedAt: item.completedAt }] : []).slice(0, 2))
const characterPresets = useCharacterPresets()
const presetName = ref('')
const presetEditName = ref('')
const lastRemovedPreset = ref<CharacterPreset>()
const selectedPresetIndex = ref(0)
const selectedPreset = computed(() => characterPresets.entries.value[selectedPresetIndex.value])
const companionPrivacy = useCompanionPrivacy()
const archive = useConversationArchive()
const microphones = useAudioInputDevices()
const speakers = useAudioOutputDevices()
const reconnect = useReconnectController()
const quality = useCallQuality()
const sessionStats = useCallSessionStats()
const latency = useTurnLatency()
const diagnosticTimeline = useDiagnosticTimeline()
const microphoneTest = useMicrophoneTest()
const speakerTest = useSpeakerTest()
const captureDiagnostics = ref<CaptureDiagnostics>()
const avatarLevel = ref(0)
const duplex = useDuplexSession((text) => {
  const intent = character.applyIntent(text)
  if (intent?.ok && intent.kind === 'character')
    duplex.stop()
}, (level) => { avatarLevel.value = level }, (userText, assistantText) => {
  archive.append(profile.value.characterId, userText, assistantText)
}, (event) => {
  latency.note(event)
  diagnosticTimeline.add(event.type, {}, event.at)
  if (event.type === 'turn.completed')
    sessionStats.noteTurn()
})
const { active: duplexActive, state: duplexState, error: duplexError, errorCode: duplexErrorCode, transcript: duplexTranscript, answer: duplexAnswer, rms: duplexRms, peak: duplexPeak, congested, muted: duplexMuted } = duplex
const duplexSupported = ref(false)
const displayedTranscript = computed(() => duplexActive.value ? duplexTranscript.value : transcript.value)
const displayedAnswer = computed(() => duplexActive.value ? duplexAnswer.value : answer.value)
const characterArchive = computed(() => archive.entries.value.filter(item => item.characterId === profile.value.characterId))
const archiveQuery = ref('')
const archiveFavoritesOnly = ref(false)
const lastRemovedConversation = ref<ConversationEntry>()
const characterFavoriteCount = computed(() => characterArchive.value.filter(item => item.favorite === true).length)
const favoriteConversationCount = computed(() => archive.entries.value.filter(item => item.favorite === true).length)
const unfavoritedConversationCount = computed(() => archive.entries.value.length - favoriteConversationCount.value)
const archiveMatches = computed(() => {
  if (!archiveQuery.value.trim())
    return archiveFavoritesOnly.value ? archive.favorites(profile.value.characterId) : archive.recent(profile.value.characterId)
  const matches = archive.search(archiveQuery.value, profile.value.characterId)
  return archiveFavoritesOnly.value ? matches.filter(item => item.favorite === true) : matches
})
const retentionOptions = [
  { label: '永久保留', days: 0 },
  { label: '保留 7 天', days: 7 },
  { label: '保留 30 天', days: 30 },
  { label: '保留 90 天', days: 90 },
]
const retentionLabel = computed(() => retentionOptions.find(item => item.days === archive.retentionDays.value)?.label || '保留 30 天')
const reconnectText = computed(() => reconnect.status.value === 'waiting-network'
  ? '等待网络恢复'
  : reconnect.status.value === 'scheduled'
    ? `第 ${reconnect.attempt.value} 次重连将在 ${Math.ceil(reconnect.delayMs.value / 1000)} 秒后进行`
    : reconnect.status.value === 'exhausted' ? '自动重连次数已用完' : '无需重连')
const echoAdvice = computed(() => echoGuidance(captureDiagnostics.value))
const selectedMicrophoneLabel = computed(() => microphones.devices.value.find(item => item.id === microphones.selectedDeviceId.value)?.label || '系统默认麦克风')
const selectedSpeakerLabel = computed(() => speakers.devices.value.find(item => item.id === speakers.selectedDeviceId.value)?.label || '系统默认扬声器')
const microphoneTestMessage = computed(() => {
  if (microphoneTest.status.value === 'starting')
    return '正在请求麦克风权限…'
  if (microphoneTest.status.value === 'listening')
    return '请以正常音量说话，最多 8 秒后自动结束。'
  if (microphoneTest.status.value === 'passed')
    return '试音通过：检测到清晰的本地输入信号。'
  if (microphoneTest.status.value === 'quiet')
    return '未检测到足够的输入信号，请检查麦克风、静音和输入设备。'
  if (microphoneTest.error.value === 'microphone_denied')
    return '麦克风权限被拒绝，请在系统设置中允许录音权限。'
  if (microphoneTest.error.value === 'duplex_not_supported')
    return '当前版本不支持本地实时试音，请更新 Android 原生通话版本或使用支持 AudioWorklet 的安全浏览器。'
  if (microphoneTest.status.value === 'error')
    return '麦克风试音中断，请检查设备后重试。'
  return '试音只在本机计算音量，不上传、不保存音频。'
})
const speakerTestMessage = computed(() => {
  if (speakerTest.status.value === 'starting')
    return '正在准备本地提示音…'
  if (speakerTest.status.value === 'playing')
    return '正在播放短提示音，请确认声音清晰且来自预期设备。'
  if (speakerTest.status.value === 'passed')
    return '提示音已播放；如果没有听到，请检查系统音量和输出设备。'
  if (speakerTest.error.value === 'output_device_not_supported')
    return '当前浏览器不支持指定输出设备，请改用系统默认扬声器。'
  if (speakerTest.status.value === 'error')
    return '扬声器试音失败，请检查系统媒体音量后重试。'
  return '试音由本机生成，不连接后端、不上传、不写入存储。'
})
let duplexRequested = false
const recoverableDuplexErrors = new Set(['seeduplex_unavailable', 'seeduplex_timeout', 'audio_backpressure', 'seeduplex_backpressure'])
const readiness = computed(() => {
  let endpointValid = true
  try {
    if (voiceProvider.value === 'seeduplex')
      validateVoiceEndpoint(wsUrl())
  }
  catch {
    endpointValid = false
  }
  return evaluateVoiceReadiness({
    online: reconnect.online.value,
    endpointValid,
    captureSupported: voiceProvider.value !== 'seeduplex' || duplexSupported.value,
    inputDetected: microphones.available.value || duplexSupported.value,
    providerConfigured: voiceProvider.value !== 'seeduplex' || !!settingsStore.seedVoiceApiKey || !!taskStatus.value?.seeduplex_api_key_configured,
    microphoneTest: microphoneTest.status.value === 'passed' ? 'passed' : ['quiet', 'error'].includes(microphoneTest.status.value) ? 'failed' : 'untested',
    speakerTest: speakerTest.status.value === 'passed' ? 'passed' : speakerTest.status.value === 'error' ? 'failed' : 'untested',
  })
})
watch([
  () => archive.entries.value,
  () => archive.retentionDays.value,
  () => characterPresets.entries.value,
  () => profile.value,
  () => voiceProvider.value,
  () => microphones.selectedDeviceId.value,
  () => speakers.selectedDeviceId.value,
], () => companionPrivacy.refresh(), { flush: 'post' })
let socket: UniApp.SocketTask | undefined
let socketReady = false
let socketGeneration = 0
let cancelConnection: (() => void) | undefined
let replyFrames: Promise<ArrayBuffer>[] = []
let replyQueue: Promise<ArrayBuffer>[] = []
let replyBytes = 0
let replyEpoch = 0
let playbackBusy = false
let segmentedReply = false
let replyTurnEnded = false
const MAX_REPLY_BYTES = 32 * 1024 * 1024
const resettingSession = ref(false)
const sessionNotice = ref('')
let resetTimer: ReturnType<typeof setTimeout> | undefined
const discardCurrentInput = ref(false)
const recordingActive = ref(false)
const inputRms = ref(0)
const inputPeak = ref(0)
const inputSignalDetected = ref(false)
const inputLevelText = computed(() => `RMS ${Math.max(-100, 20 * Math.log10(inputRms.value)).toFixed(0)} dBFS · 峰值 ${Math.max(-100, 20 * Math.log10(inputPeak.value)).toFixed(0)} dBFS`)
const MAX_AUDIO_BYTES = 2 * 1024 * 1024
const MAX_AUDIO_SECONDS = 64
let webAudioEnabled = false
// #ifdef H5
webAudioEnabled = true
// #endif
// #ifdef APP-PLUS
const recorder = uni.getRecorderManager()
let nativeStopHandler: ((event: { tempFilePath?: string }) => void) | undefined
let audioContext: UniApp.InnerAudioContext | undefined
let nativePlaybackFile = ''
let recordingBytes = 0
// #endif
// #ifdef H5
let h5AudioContext: AudioContext | undefined
let h5Stream: MediaStream | undefined
let h5Source: MediaStreamAudioSourceNode | undefined
let h5Processor: ScriptProcessorNode | undefined
let h5Mute: GainNode | undefined
let h5Chunks: Float32Array[] = []
let h5SampleCount = 0
let h5DurationTimer: ReturnType<typeof setTimeout> | undefined
let h5Audio: HTMLAudioElement | undefined
let h5ObjectUrl = ''
// #endif
let timer: ReturnType<typeof setInterval> | undefined
let pcmFrames: ArrayBuffer[] = []
let turnId = ''
let lastArchivedTurnId = ''
let playbackTurnId = ''
let playbackGeneration = 0
let recordingGeneration = 0
let pageActive = false
function stopDuplex() {
  duplexRequested = false
  reconnect.cancel()
  quality.stop()
  sessionStats.stop()
  transcript.value = duplexTranscript.value
  answer.value = duplexAnswer.value
  duplex.stop()
}
function openSettings() {
  uni.navigateTo({ url: '/pages/mine/settings' })
}
async function connectDuplex() {
  if (!pageActive || voiceProvider.value !== 'seeduplex' || voiceState.value !== 'idle' || microphoneTest.active.value)
    return
  interruptVoice()
  duplexRequested = true
  socketGeneration++
  cancelConnection?.()
  socketReady = false
  const previous = socket
  socket = undefined
  previous?.close({ code: 1000, reason: 'duplex started' })
  voiceError.value = ''
  transcript.value = answer.value = ''
  if (!reconnect.online.value) {
    reconnect.schedule(connectDuplex)
    return
  }
  await duplex.start(
    wsUrl(),
    { character_id: profile.value.characterId, persona_id: profile.value.personaId, voice_id: profile.value.voiceId },
    settingsStore.seedVoiceApiKey || '',
    {
      deviceId: microphones.selectedDeviceId.value,
      outputDeviceId: speakers.selectedDeviceId.value,
      onConfigured: (diagnostics) => {
        captureDiagnostics.value = diagnostics
        void microphones.refresh()
      },
    },
  )
}
async function startDuplex() {
  if (microphoneTest.active.value)
    return
  reconnect.cancel()
  quality.reset()
  sessionStats.reset()
  duplexRequested = true
  await connectDuplex()
}
function retryDuplexNow() {
  if (!reconnect.retryNow())
    void connectDuplex()
}
function cancelDuplexReconnect() {
  duplexRequested = false
  reconnect.cancel()
}
function chooseCharacter(index: number) {
  duplexRequested = false
  reconnect.cancel()
  quality.stop()
  sessionStats.stop()
  duplex.stop()
  interruptVoice()
  socketGeneration++
  cancelConnection?.()
  socketReady = false
  socket?.close({ code: 1000, reason: 'character changed' })
  socket = undefined
  character.changeCharacter(CHARACTERS[index]?.id || '')
  transcript.value = answer.value = ''
}
function selectFace(index: number) {
  character.changeFace(FACES[index]?.id || '')
}
function selectOutfit(index: number) {
  const selected = OUTFITS[index]
  if (selected) {
    character.changeOutfit(selected.id, selected.library)
  }
}
function selectPose(index: number) {
  character.changePose(POSES[index]?.id || '')
}

function saveCharacterPreset() {
  const label = presetName.value.trim() || `${profile.value.displayName}造型 ${characterPresets.entries.value.length + 1}`
  const saved = characterPresets.save(label, profile.value)
  if (!saved) {
    uni.showToast({ title: '预设名称无效、重复或已达上限', icon: 'none' })
    return
  }
  presetName.value = ''
  selectedPresetIndex.value = 0
  presetEditName.value = saved.label
  uni.showToast({ title: '造型预设已保存', icon: 'success' })
}
function applyCharacterPreset(index: number) {
  const preset = characterPresets.entries.value[index]
  if (!preset)
    return
  selectedPresetIndex.value = index
  presetEditName.value = preset.label
  const ok = character.changeCharacter(preset.characterId)
    && character.changeFace(preset.faceId)
    && character.changeOutfit(preset.outfitId, preset.outfitLibrary)
    && character.changePose(preset.poseId)
  uni.showToast({ title: ok ? '已应用造型预设' : '预设资源已失效', icon: 'none' })
}
function renameSelectedPreset() {
  if (!selectedPreset.value)
    return
  const renamed = characterPresets.rename(selectedPreset.value.id, presetEditName.value)
  if (!renamed) {
    uni.showToast({ title: '请输入未被使用的有效名称', icon: 'none' })
    return
  }
  presetEditName.value = renamed.label
  uni.showToast({ title: '预设已重命名', icon: 'none' })
}
function copySelectedPreset() {
  if (!selectedPreset.value)
    return
  const copied = characterPresets.copy(selectedPreset.value.id, presetEditName.value)
  if (!copied) {
    uni.showToast({ title: '预设名称已存在或达到上限', icon: 'none' })
    return
  }
  selectedPresetIndex.value = 0
  presetEditName.value = copied.label
  uni.showToast({ title: '预设副本已创建', icon: 'none' })
}
function removeSelectedPreset() {
  if (!selectedPreset.value)
    return
  const removed = characterPresets.remove(selectedPreset.value.id)
  if (!removed)
    return
  lastRemovedPreset.value = removed
  selectedPresetIndex.value = 0
  presetEditName.value = ''
  uni.showToast({ title: '造型预设已删除，可撤销', icon: 'none' })
}
function undoPresetRemoval() {
  const removed = lastRemovedPreset.value
  if (!removed)
    return
  characterPresets.importEntries([removed], 'merge')
  lastRemovedPreset.value = undefined
  selectedPresetIndex.value = 0
  presetEditName.value = removed.label
  uni.showToast({ title: '造型预设已恢复', icon: 'success' })
}

async function enqueuePortrait() {
  if (!settingsStore.useMock && !await confirmCloudCost('高清写真将调用云端图像模型，可能消耗账号额度。是否加入生成队列？'))
    return
  if (portraitQueue.enqueue({ ...profile.value }))
    return
  uni.showToast({ title: '写真队列最多保留 3 个任务', icon: 'none' })
}
function retryPortrait(taskId: string) {
  if (portraitQueue.retry(taskId))
    return
  uni.showToast({ title: '队列已满或任务无需重试', icon: 'none' })
}
function portraitHistoryLabel(status: 'success' | 'failed' | 'cancelled') {
  return status === 'success' ? '生成成功' : status === 'failed' ? '生成失败' : '已取消'
}
function portraitHistoryTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function portraitSnapshotLabel(snapshot: CharacterProfile) {
  const characterLabel = CHARACTERS.find(item => item.id === snapshot.characterId)?.label || snapshot.displayName
  const outfitLabel = OUTFITS.find(item => item.id === snapshot.outfitId && item.library === snapshot.outfitLibrary)?.label || snapshot.outfitId
  const poseLabel = POSES.find(item => item.id === snapshot.poseId)?.label || snapshot.poseId
  return `${characterLabel} · ${outfitLabel} · ${poseLabel}`
}
function showPortraitResult(item: { payload: CharacterProfile, result: GeneratedPortrait }) {
  if (character.usePortraitResult(item.payload, item.result)) {
    uni.showToast({ title: '已恢复写真造型', icon: 'none' })
    return
  }
  uni.showToast({ title: '写真结果已失效', icon: 'none' })
}
function releaseCurrentPortrait() {
  character.clearPortrait()
  portraitQueue.clearHistory()
  uni.showToast({ title: '高清写真内存已释放', icon: 'none' })
}
function selectMicrophone(index: number) {
  microphones.select(microphones.devices.value[index]?.id || '')
  if (duplexActive.value) {
    duplex.stop()
    if (duplexRequested)
      void connectDuplex()
  }
}
function selectSpeaker(index: number) {
  speakers.select(speakers.devices.value[index]?.id || '')
  if (duplexActive.value) {
    duplex.stop()
    if (duplexRequested)
      void connectDuplex()
  }
}
function exportConversationArchive() {
  uni.setClipboardData({
    data: archive.exportJson(),
    success: () => uni.showToast({ title: '记录已复制', icon: 'success' }),
  })
}
function exportFavoriteConversationArchive() {
  uni.setClipboardData({
    data: archive.exportJson('favorites'),
    success: () => uni.showToast({ title: '收藏记录已复制', icon: 'success' }),
  })
}
function exportConversationArchiveFile(scope: ConversationArchiveScope) {
  const content = archive.exportJson(scope)
  // #ifdef H5
  try {
    const filename = downloadConversationArchiveFile(content, scope)
    uni.showToast({ title: `已下载 ${filename}`, icon: 'none' })
    return
  }
  catch {}
  // #endif
  uni.setClipboardData({
    data: content,
    success: () => uni.showToast({ title: scope === 'favorites' ? '收藏记录已复制' : '记录已复制', icon: 'none' }),
  })
}
function importConversationArchive() {
  uni.getClipboardData({
    success: ({ data }) => {
      try {
        const count = archive.importJson(String(data || ''))
        uni.showToast({ title: `已导入 ${count} 条`, icon: 'success' })
      }
      catch (cause) {
        uni.showModal({ title: '导入失败', content: cause instanceof Error ? cause.message : '记录格式无效', showCancel: false })
      }
    },
  })
}
function removeConversationEntry(id: string) {
  uni.showModal({
    title: '删除这条本地对话',
    content: '删除后可在离开当前页面前撤销；其他对话记录不会受影响。',
    confirmText: '确认删除',
    success: ({ confirm }) => {
      if (!confirm)
        return
      const removed = archive.removeEntry(id)
      lastRemovedConversation.value = removed
      companionPrivacy.refresh()
      uni.showToast({ title: removed ? '已删除，可撤销' : '记录已不存在', icon: 'none' })
    },
  })
}
function undoConversationRemoval() {
  const removed = lastRemovedConversation.value
  if (!removed)
    return
  archive.restoreEntries([removed], 'merge')
  lastRemovedConversation.value = undefined
  companionPrivacy.refresh()
  uni.showToast({ title: '已恢复本地对话', icon: 'success' })
}
function toggleConversationFavorite(id: string) {
  const favorite = archive.toggleFavorite(id)
  if (favorite === undefined)
    uni.showToast({ title: '记录已不存在', icon: 'none' })
}
function clearConversationArchive(all = false) {
  uni.showModal({
    title: all ? '清除全部本地记录' : `清除${profile.value.displayName}的记录`,
    content: '该操作只删除本机文本记录，且无法撤销。',
    confirmText: '确认清除',
    success: ({ confirm }) => {
      if (!confirm)
        return
      if (all)
        archive.clearAll()
      else
        archive.clearCharacter(profile.value.characterId)
    },
  })
}
function clearUnfavoritedConversations() {
  uni.showModal({
    title: '清理未收藏对话',
    content: `将删除 ${unfavoritedConversationCount.value} 条未收藏记录，收藏记录会保留。该操作无法撤销。`,
    confirmText: '确认清理',
    success: ({ confirm }) => {
      if (!confirm)
        return
      const removed = archive.clearUnfavorited()
      lastRemovedConversation.value = undefined
      companionPrivacy.refresh()
      uni.showToast({ title: `已清理 ${removed} 条`, icon: 'none' })
    },
  })
}
function clearCompanionData() {
  uni.showModal({
    title: '清除本机陪伴数据',
    content: '将清除对话记录、角色与造型预设、记录期限和音频设备偏好。其他业务数据及后端配置不受影响。',
    success: ({ confirm }) => {
      if (!confirm)
        return
      duplexRequested = false
      reconnect.cancel()
      quality.stop()
      interruptVoice()
      duplex.stop()
      portraitQueue.cancelAll()
      archive.clearAll()
      archive.setRetentionDays(30)
      characterPresets.clear()
      microphones.select('')
      speakers.select('')
      character.resetCharacter()
      diagnosticTimeline.clear()
      const removed = companionPrivacy.clearLocalData()
      voiceProviderPreference.reset()
      archiveQuery.value = ''
      presetName.value = ''
      presetEditName.value = ''
      selectedPresetIndex.value = 0
      uni.showToast({ title: removed ? '本机陪伴数据已清除' : '没有需要清除的数据', icon: 'none' })
    },
  })
}
function copyDiagnosticReport() {
  const report = createDiagnosticReport({
    provider: voiceProvider.value,
    characterId: profile.value.characterId,
    online: reconnect.online.value,
    reconnectStatus: reconnect.status.value,
    reconnectAttempt: reconnect.attempt.value,
    voiceState: voiceState.value,
    duplexState: duplexState.value,
    duplexErrorCode: duplexErrorCode.value,
    quality: {
      grade: quality.grade.value,
      durationSeconds: quality.durationSeconds.value,
      reconnects: quality.reconnects.value,
      congestionEvents: quality.congestionEvents.value,
    },
    latency: latency.metrics.value,
    readiness: readiness.value.checks,
    audio: {
      inputAvailable: microphones.available.value,
      outputAvailable: speakers.available.value,
      echoCancellation: captureDiagnostics.value?.echoCancellation,
      noiseSuppression: captureDiagnostics.value?.noiseSuppression,
      autoGainControl: captureDiagnostics.value?.autoGainControl,
    },
    localData: {
      transcripts: archive.entries.value.length,
      presets: characterPresets.entries.value.length,
      portraitQueue: portraitQueue.size.value,
      portraitHistory: portraitQueue.history.value.length,
    },
    events: diagnosticTimeline.entries.value.map(({ at, type, code, value }) => ({ at, type, code, value })),
    toolCalls: avatarToolAudit.value.map(({ at, source, name, status, code }) => ({ at, source, name, status, code })),
  })
  uni.setClipboardData({
    data: JSON.stringify(report, null, 2),
    success: () => uni.showToast({ title: '脱敏诊断已复制', icon: 'none' }),
    fail: () => uni.showToast({ title: '复制失败，请检查剪贴板权限', icon: 'none' }),
  })
}
function copyCallSessionSummary() {
  uni.setClipboardData({
    data: createCallSessionSummary({
      characterName: profile.value.displayName,
      provider: voiceProvider.value,
      durationSeconds: sessionStats.durationSeconds.value,
      turns: sessionStats.turns.value,
      interrupts: sessionStats.interrupts.value,
      mutedSeconds: sessionStats.mutedSeconds.value,
      qualityGrade: quality.grade.value,
    }),
    success: () => uni.showToast({ title: '通话摘要已复制', icon: 'none' }),
    fail: () => uni.showToast({ title: '复制失败，请检查剪贴板权限', icon: 'none' }),
  })
}
function companionBackupJson() {
  const backup = createCompanionBackup({
    character: profile.value,
    presets: characterPresets.entries.value,
    conversations: archive.entries.value,
    retentionDays: archive.retentionDays.value,
    voiceProvider: voiceProvider.value,
  })
  return JSON.stringify(backup, null, 2)
}
function copyCompanionBackup() {
  uni.setClipboardData({
    data: companionBackupJson(),
    success: () => uni.showToast({ title: '完整备份已复制', icon: 'none' }),
    fail: () => uni.showToast({ title: '备份复制失败', icon: 'none' }),
  })
}
function applyCompanionBackup(backup: CompanionBackup, mode: 'merge' | 'replace') {
  const snapshot = {
    character: { ...profile.value },
    presets: characterPresets.entries.value.map(item => ({ ...item })),
    conversations: archive.entries.value.map(item => ({ ...item })),
    retentionDays: archive.retentionDays.value,
    voiceProvider: voiceProvider.value,
  }
  const restoreCharacterSelection = (selection: CompanionBackup['character']) => {
    character.resetCharacter()
    const restored = character.changeCharacter(selection.characterId)
      && character.changeFace(selection.faceId)
      && character.changeOutfit(selection.outfitId, selection.outfitLibrary)
      && character.changePose(selection.poseId)
    if (!restored)
      throw new Error('角色状态恢复失败。')
  }
  duplexRequested = false
  reconnect.cancel()
  quality.stop()
  interruptVoice()
  duplex.stop()
  portraitQueue.cancelAll()
  const result = executeCompanionRestoreTransaction(() => {
    if (mode === 'replace') {
      if (!archive.setRetentionDays(backup.preferences.retentionDays))
        throw new Error('对话保留期限恢复失败。')
      restoreCharacterSelection(backup.character)
      if (!voiceProviderPreference.select(backup.preferences.voiceProvider))
        throw new Error('首选语音引擎恢复失败。')
    }
    characterPresets.importEntries(backup.presets, mode)
    archive.restoreEntries(backup.conversations, mode)
  }, () => {
    const rollbackErrors: unknown[] = []
    const attempt = (action: () => void) => {
      try {
        action()
      }
      catch (cause) {
        rollbackErrors.push(cause)
      }
    }
    attempt(() => {
      if (!archive.setRetentionDays(snapshot.retentionDays))
        throw new Error('对话保留期限回滚失败。')
    })
    attempt(() => archive.restoreEntries(snapshot.conversations, 'replace'))
    attempt(() => restoreCharacterSelection(snapshot.character))
    attempt(() => {
      if (!voiceProviderPreference.select(snapshot.voiceProvider))
        throw new Error('首选语音引擎回滚失败。')
    })
    attempt(() => characterPresets.importEntries(snapshot.presets, 'replace'))
    if (rollbackErrors.length)
      throw new Error(`陪伴数据有 ${rollbackErrors.length} 项回滚失败。`)
  })
  if (!result.ok) {
    uni.showModal({
      title: result.rollbackError ? '恢复与回滚均失败' : '恢复失败，已回滚',
      content: result.rollbackError
        ? '本机数据可能处于不完整状态，请先不要继续操作，并从原备份重新恢复。'
        : '恢复过程中发生错误，本机陪伴数据已恢复到操作前状态。',
      showCancel: false,
    })
    return
  }
  selectedPresetIndex.value = 0
  presetEditName.value = ''
  archiveQuery.value = ''
  companionPrivacy.refresh()
  uni.showToast({ title: mode === 'replace' ? '备份已替换恢复' : '备份已合并', icon: 'none' })
}
function restoreCompanionBackupRaw(raw: string) {
  let backup: CompanionBackup
  try {
    backup = parseCompanionBackup(raw)
  }
  catch (cause) {
    uni.showModal({ title: '备份校验失败', content: cause instanceof Error ? cause.message : '陪伴备份无效', showCancel: false })
    return
  }
  const summary = summarizeCompanionBackup(backup, {
    presets: characterPresets.entries.value,
    conversations: archive.entries.value,
  })
  const providerLabels: Record<VoiceProvider, string> = {
    'local': '本地语音',
    'seeduplex': 'SeedDuplex',
    'open-llm-vtuber': 'Open LLM Vtuber',
  }
  const retention = summary.retentionDays === 0 ? '永久' : `${summary.retentionDays} 天`
  const preview = [
    `角色：${summary.characterLabel}`,
    `造型预设：${summary.presetCount} 个（合并新增 ${summary.merge.newPresets} / 更新 ${summary.merge.updatedPresets}）`,
    `对话记录：${summary.conversationCount} 条（合并新增 ${summary.merge.newConversations} / 更新 ${summary.merge.updatedConversations}）`,
    `内容冲突：预设 ${summary.merge.conflictingPresets} 个 / 对话 ${summary.merge.conflictingConversations} 条（合并时以备份为准）`,
    `对话文本：${summary.textChars} 字符`,
    `替换时移除：预设 ${summary.replace.removedPresets} 个 / 对话 ${summary.replace.removedConversations} 条`,
    `完整性：${summary.integrity.algorithm.toUpperCase()} 已验证（${summary.integrity.checksum}）`,
    `保留期限：${retention}`,
    `首选引擎：${providerLabels[summary.voiceProvider]}`,
  ].join('\n')
  uni.showModal({
    title: '确认备份内容',
    content: preview,
    confirmText: '选择恢复方式',
    success: ({ confirm }) => {
      if (!confirm)
        return
      uni.showActionSheet({
        itemList: ['合并预设与对话', '替换全部备份数据'],
        success: ({ tapIndex }) => {
          if (tapIndex === 0) {
            applyCompanionBackup(backup, 'merge')
            return
          }
          if (tapIndex === 1) {
            uni.showModal({
              title: '替换本机陪伴数据',
              content: '将替换角色、造型预设、对话记录、保留期限和首选语音引擎。Key、音频、设备 ID 和地址不会恢复。',
              confirmText: '确认替换',
              success: ({ confirm: replaceConfirmed }) => {
                if (replaceConfirmed)
                  applyCompanionBackup(backup, 'replace')
              },
            })
          }
        },
      })
    },
  })
}
function importCompanionBackup() {
  uni.getClipboardData({
    success: ({ data }) => {
      restoreCompanionBackupRaw(String(data || ''))
    },
  })
}
function exportCompanionBackupFile() {
  const content = companionBackupJson()
  // #ifdef H5
  try {
    const filename = downloadCompanionBackupFile(content)
    uni.showToast({ title: `已下载 ${filename}`, icon: 'none' })
    return
  }
  catch {
    copyCompanionBackup()
    return
  }
  // #endif
  // #ifdef APP-PLUS
  const filename = companionBackupFilename()
  const userDataPath = (uni as unknown as { env?: { USER_DATA_PATH?: string } }).env?.USER_DATA_PATH
  if (!userDataPath) {
    copyCompanionBackup()
    return
  }
  const filePath = `${userDataPath}/${filename}`
  uni.getFileSystemManager().writeFile({
    filePath,
    data: content,
    encoding: 'utf8',
    success: () => {
      uni.openDocument({
        filePath,
        showMenu: true,
        fail: () => uni.showToast({ title: `备份已保存：${filename}`, icon: 'none' }),
      })
    },
    fail: copyCompanionBackup,
  })
  return undefined
  // #endif
  copyCompanionBackup()
}
async function importCompanionBackupFile() {
  // #ifdef H5
  try {
    restoreCompanionBackupRaw(await chooseCompanionBackupFile())
  }
  catch (cause) {
    if (isCompanionBackupFileCancelled(cause))
      return
    importCompanionBackup()
  }
  return undefined
  // #endif
  // #ifdef APP-PLUS
  interface FileChoice { name?: string, path?: string, size?: number }
  interface FileChoiceResult { tempFiles?: FileChoice[], tempFilePaths?: string[] }
  const chooseFile = (uni as unknown as { chooseFile?: (options: { count: number, extension: string[], success: (result: FileChoiceResult) => void, fail: () => void }) => void }).chooseFile
  if (!chooseFile) {
    importCompanionBackup()
    return
  }
  chooseFile({
    count: 1,
    extension: ['json'],
    success: ({ tempFiles, tempFilePaths }) => {
      const selected = tempFiles?.[0]
      const filePath = selected?.path || tempFilePaths?.[0] || ''
      if (!filePath) {
        importCompanionBackup()
        return
      }
      uni.getFileSystemManager().readFile({
        filePath,
        encoding: 'utf8',
        success: ({ data }) => {
          try {
            const content = String(data || '')
            restoreCompanionBackupRaw(validateCompanionBackupFile(selected?.name || filePath.split('/').pop() || 'backup.json', selected?.size || content.length, content))
          }
          catch {
            importCompanionBackup()
          }
        },
        fail: importCompanionBackup,
      })
    },
    fail: importCompanionBackup,
  })
  return undefined
  // #endif
  importCompanionBackup()
}
function selectRetention(index: number) {
  const selected = retentionOptions[index]
  if (selected)
    archive.setRetentionDays(selected.days)
}
const taskLabels: Record<string, string> = {
  'download-qwen': 'Qwen 对话模型下载',
  'download-cosyvoice': 'CosyVoice 语音模型与环境安装',
  'run-qwen': '启动 Qwen 服务',
  'run-funasr': '启动 FunASR 并下载识别模型',
  'run-cosyvoice': '启动 CosyVoice 语音合成',
}
const pending = computed(() => todos.value?.items.filter(item => !item.completed) ?? [])
const completed = computed(() => todos.value?.items.filter(item => item.completed) ?? [])

function releaseNativePlayback() {
  // #ifdef APP-PLUS
  audioContext?.stop()
  audioContext?.destroy()
  audioContext = undefined
  if (nativePlaybackFile) {
    uni.getFileSystemManager().unlink({ filePath: nativePlaybackFile })
    nativePlaybackFile = ''
  }
  // #endif
}

function releaseH5Playback() {
  // #ifdef H5
  if (h5Audio) {
    h5Audio.pause()
    h5Audio.onended = null
    h5Audio.onerror = null
    h5Audio.removeAttribute('src')
    h5Audio.load()
    h5Audio = undefined
  }
  if (h5ObjectUrl) {
    URL.revokeObjectURL(h5ObjectUrl)
    h5ObjectUrl = ''
  }
  // #endif
}

function stopPlayback() {
  replyEpoch++
  playbackGeneration++
  releaseNativePlayback()
  releaseH5Playback()
  replyFrames = []
  replyQueue = []
  replyBytes = 0
  playbackBusy = false
  segmentedReply = false
  replyTurnEnded = false
}

function updateReplyState() {
  if (!playbackBusy && !replyQueue.length && !replyFrames.length)
    voiceState.value = replyTurnEnded ? 'idle' : 'processing'
}

function finishPlayback(activePlayback: number, activeProvider: VoiceProvider, activeTurnId: string) {
  if (activePlayback !== playbackGeneration)
    return
  playbackGeneration++
  if (activeProvider === 'open-llm-vtuber' && !segmentedReply)
    sendJson({ type: 'playback.complete', turn_id: activeTurnId })
  releaseNativePlayback()
  releaseH5Playback()
  playbackBusy = false
  void playNextReply()
}

function failReply(message: string) {
  sendJson({ type: 'assistant.cancel', turn_id: playbackTurnId || turnId })
  stopPlayback()
  playbackTurnId = ''
  turnId = ''
  voiceError.value = message
  voiceState.value = 'idle'
}

function failPlayback(activePlayback: number) {
  if (activePlayback === playbackGeneration)
    failReply('音频播放失败，请检查设备音频输出')
}

function selectProvider(provider: VoiceProvider) {
  if (provider !== voiceProvider.value)
    duplex.stop()
  if (recordingActive.value || voiceState.value !== 'idle' || resettingSession.value || microphoneTest.active.value || provider === voiceProvider.value)
    return
  socketGeneration++
  cancelConnection?.()
  socketReady = false
  const previous = socket
  socket = undefined
  previous?.close({ code: 1000, reason: 'provider changed' })
  stopPlayback()
  turnId = ''
  playbackTurnId = ''
  replyFrames = []
  voiceError.value = ''
  voiceProviderPreference.select(provider)
}

function micErrorMessage(error: unknown) {
  const name = typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string' ? error.name : ''
  if (name === 'NotAllowedError')
    return '麦克风权限被拒绝，请在 MuMu 系统设置中允许麦克风权限'
  if (name === 'NotFoundError')
    return '未检测到可用麦克风，请检查 MuMu 音频输入设备'
  if (name === 'NotReadableError')
    return '麦克风无法读取，可能被其他应用占用；请检查 MuMu 音频输入并重试'
  return error instanceof Error ? error.message : '无法开始录音'
}

function inputCodec() {
  // #ifdef H5
  return 'pcm_s16le'
  // #endif
  // #ifndef H5
  return 'mp3'
  // #endif
}

function wsUrl() {
  const base = settingsStore.serverBaseUrl.trim().replace(/\/+$/, '')
  return `${base.replace(/^http/i, 'ws')}/api/v1/voice/ws`
}

function sendJson(payload: Record<string, unknown>) {
  if (!socketReady || !socket)
    return false
  socket.send({ data: JSON.stringify(payload) })
  return true
}

function concatBuffers(frames: ArrayBuffer[]) {
  const size = frames.reduce((total, frame) => total + frame.byteLength, 0)
  const output = new Uint8Array(size)
  let offset = 0
  for (const frame of frames) {
    output.set(new Uint8Array(frame), offset)
    offset += frame.byteLength
  }
  return output.buffer
}

// #ifdef APP-PLUS
function base64FromBytes(buffer: ArrayBuffer) {
  return uni.arrayBufferToBase64(buffer)
}
// #endif

async function playNextReply() {
  if (playbackBusy)
    return
  const next = replyQueue.shift()
  if (!next) {
    updateReplyState()
    return
  }
  playbackBusy = true
  voiceState.value = 'processing'
  const epoch = replyEpoch
  let wav: ArrayBuffer
  try {
    wav = await next
  }
  catch {
    if (epoch === replyEpoch)
      failReply('无法解码语音回复')
    return
  }
  if (!pageActive || epoch !== replyEpoch)
    return
  const activePlayback = ++playbackGeneration
  const activeTurnId = playbackTurnId || turnId
  const activeProvider = voiceProvider.value
  voiceState.value = 'playing'
  // #ifdef H5
  releaseH5Playback()
  h5ObjectUrl = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }))
  h5Audio = new Audio(h5ObjectUrl)
  h5Audio.onended = () => finishPlayback(activePlayback, activeProvider, activeTurnId)
  h5Audio.onerror = () => failPlayback(activePlayback)
  void h5Audio.play().catch(() => failPlayback(activePlayback))
  // #endif
  // #ifdef APP-PLUS
  const { env } = uni as typeof uni & { env: { USER_DATA_PATH: string } }
  const filePath = `${env.USER_DATA_PATH}/nvzhuang-voice-${Date.now()}-${activePlayback}.wav`
  nativePlaybackFile = filePath
  uni.getFileSystemManager().writeFile({
    filePath,
    data: base64FromBytes(wav),
    encoding: 'base64',
    success: () => {
      if (activePlayback !== playbackGeneration || !pageActive) {
        uni.getFileSystemManager().unlink({ filePath })
        if (nativePlaybackFile === filePath)
          nativePlaybackFile = ''
        return
      }
      const player = uni.createInnerAudioContext()
      audioContext = player
      player.autoplay = true
      player.src = filePath
      player.onEnded(() => finishPlayback(activePlayback, activeProvider, activeTurnId))
      player.onError(() => failPlayback(activePlayback))
    },
    fail: () => {
      uni.getFileSystemManager().unlink({ filePath })
      failPlayback(activePlayback)
    },
  })
  // #endif
}

function finishReply() {
  const frames = replyFrames
  replyFrames = []
  if (frames.length) {
    const ready = Promise.all(frames).then(concatBuffers)
    // A queued segment may fail before its turn to play; the consumer still handles that failure.
    void ready.catch(() => {})
    replyQueue.push(ready)
  }
  if (!segmentedReply)
    replyTurnEnded = true
  void playNextReply()
}

function queueReplyFrame(ready: Promise<ArrayBuffer>, size: number) {
  if (replyBytes + size > MAX_REPLY_BYTES) {
    void ready.catch(() => {})
    failReply('语音回复超过 32 MiB 限制，已取消本轮')
    return
  }
  replyBytes += size
  void ready.catch(() => {})
  replyFrames.push(ready)
}

function cancelSessionReset() {
  if (resetTimer)
    clearTimeout(resetTimer)
  resetTimer = undefined
  resettingSession.value = false
}

function resetSession() {
  if (voiceProvider.value !== 'local' || voiceState.value !== 'idle' || recordingActive.value || resettingSession.value)
    return
  sessionNotice.value = ''
  if (!sendJson({ type: 'session.reset' })) {
    voiceError.value = '请先完成一次语音连接，再清空当前会话记忆'
    return
  }
  resettingSession.value = true
  resetTimer = setTimeout(() => {
    cancelSessionReset()
    voiceError.value = '清空记忆确认超时，请重试'
  }, 15000)
}

function openSocket() {
  const endpoint = voiceProvider.value === 'seeduplex' ? validateVoiceEndpoint(wsUrl()) : wsUrl()
  return new Promise<void>((resolve, reject) => {
    voiceState.value = 'connecting'
    const generation = ++socketGeneration
    const provider = voiceProvider.value
    socketReady = false
    const activeSocket = uni.connectSocket({ url: endpoint, timeout: 10000, success: () => {} })
    socket = activeSocket
    const isCurrent = () => pageActive && socket === activeSocket && generation === socketGeneration
    let settled = false
    let connectionTimer: ReturnType<typeof setTimeout>
    const finish = (message?: string) => {
      if (settled)
        return
      settled = true
      clearTimeout(connectionTimer)
      if (generation === socketGeneration)
        cancelConnection = undefined
      if (!isCurrent()) {
        reject(new Error('语音连接已取消'))
        return
      }
      if (message) {
        socketReady = false
        socket = undefined
        activeSocket.close({ code: 1000, reason: 'connection failed' })
        reject(new Error(message))
      }
      else {
        socketReady = true
        resolve()
      }
    }
    cancelConnection = () => finish('语音连接已取消')
    connectionTimer = setTimeout(() => finish('语音服务连接超时，请检查后端及所选引擎是否启动'), 15000)
    activeSocket.onOpen(() => {
      if (!isCurrent())
        return
      activeSocket.send({ data: JSON.stringify({ type: 'session.start', provider, ...(provider === 'seeduplex' && settingsStore.seedVoiceApiKey ? { api_key: settingsStore.seedVoiceApiKey } : {}), ...(provider === 'open-llm-vtuber' ? {} : { character_id: profile.value.characterId, persona_id: profile.value.personaId, voice_id: profile.value.voiceId }), input_rate: 16000, codec: inputCodec() }) })
      if (provider !== 'open-llm-vtuber')
        finish()
    })
    const disconnect = (detail: string) => {
      if (!isCurrent())
        return
      socketReady = false
      cancelSessionReset()
      finish(detail)
      socket = undefined
      activeSocket.close({ code: 1000, reason: 'disconnected' })
      stopPlayback()
      playbackTurnId = ''
      if (webAudioEnabled || recordingActive.value)
        stopActiveRecording(true)
      voiceError.value = detail
      voiceState.value = 'idle'
    }
    activeSocket.onError(() => disconnect('WebSocket 连接失败，请确认 GoFrame 地址和 MuMu 网络设置'))
    activeSocket.onClose(() => disconnect('语音连接已断开，请确认所选引擎已启动后重试'))
    activeSocket.onMessage((event) => {
      if (!isCurrent())
        return
      const data: unknown = event.data
      if (typeof data !== 'string') {
        if (!playbackTurnId)
          return
        if (data instanceof ArrayBuffer) {
          queueReplyFrame(Promise.resolve(data), data.byteLength)
          return
        }
        // #ifdef H5
        if (data instanceof Blob) {
          queueReplyFrame(data.arrayBuffer(), data.size)
          return
        }
        // #endif
        failReply('收到无法播放的语音数据')
        return
      }
      try {
        const message = JSON.parse(event.data) as { type?: string, text?: string, message?: string, turn_id?: string, segment?: boolean, character_id?: string, persona_id?: string, voice_id?: string }
        if (message.type === 'session.reset' && resettingSession.value) {
          cancelSessionReset()
          stopPlayback()
          turnId = ''
          playbackTurnId = ''
          transcript.value = ''
          answer.value = ''
          voiceError.value = ''
          sessionNotice.value = '当前连接的会话记忆已清空'
          return
        }
        if (message.turn_id && message.turn_id !== turnId)
          return
        if (message.type === 'session.ready') {
          if (provider !== 'open-llm-vtuber' && (profile.value.characterId === 'linxi' || message.character_id || message.persona_id || message.voice_id)
            && (message.character_id !== profile.value.characterId || message.persona_id !== profile.value.personaId || message.voice_id !== profile.value.voiceId)) {
            disconnect('当前后端未确认所选角色的人设与音色，请升级后端或选择其他角色')
            return
          }
          finish()
        }
        if (message.type === 'turn.end') {
          if (turnId && lastArchivedTurnId !== turnId && (transcript.value || answer.value)) {
            lastArchivedTurnId = turnId
            archive.append(profile.value.characterId, transcript.value, answer.value)
          }
          replyTurnEnded = true
          updateReplyState()
        }
        if (message.type === 'asr.final') {
          transcript.value = message.text || ''
          const intent = character.applyIntent(transcript.value)
          if (intent?.ok && intent.kind === 'character') {
            chooseCharacter(CHARACTERS.findIndex(item => item.id === profile.value.characterId))
            return
          }
        }
        if (message.type === 'assistant.text.delta') {
          if (voiceProvider.value === 'local')
            answer.value += message.text || ''
          else
            answer.value = message.text || ''
        }
        if (message.type === 'assistant.audio.start' && turnId) {
          if (playbackTurnId !== turnId || !message.segment)
            stopPlayback()
          playbackTurnId = message.turn_id || turnId
          segmentedReply = message.segment === true
        }
        if (message.type === 'assistant.audio.end' && playbackTurnId)
          finishReply()
        if (message.type === 'assistant.cancel') {
          stopPlayback()
          playbackTurnId = ''
          voiceState.value = recordingActive.value ? 'recording' : 'idle'
        }
        if (message.type === 'error') {
          const detail = message.message || '语音处理失败'
          cancelSessionReset()
          finish(detail)
          stopPlayback()
          playbackTurnId = ''
          if (webAudioEnabled || recordingActive.value)
            stopActiveRecording(true)
          voiceError.value = detail
          voiceState.value = 'idle'
        }
      }
      catch { voiceError.value = '收到无法解析的语音服务消息' }
    })
  })
}

// #ifdef H5
function releaseH5Recorder() {
  if (h5DurationTimer)
    clearTimeout(h5DurationTimer)
  h5DurationTimer = undefined
  if (h5Processor) {
    h5Processor.onaudioprocess = null
    h5Processor.disconnect()
    h5Processor = undefined
  }
  h5Source?.disconnect()
  h5Source = undefined
  h5Mute?.disconnect()
  h5Mute = undefined
  h5Stream?.getTracks().forEach(track => track.stop())
  h5Stream = undefined
  if (h5AudioContext && h5AudioContext.state !== 'closed')
    void h5AudioContext.close()
  h5AudioContext = undefined
  h5Chunks = []
  h5SampleCount = 0
}

function pcm16k(chunks: Float32Array[], sampleCount: number, sourceRate: number) {
  const input = new Float32Array(sampleCount)
  let inputOffset = 0
  for (const chunk of chunks) {
    input.set(chunk, inputOffset)
    inputOffset += chunk.length
  }
  const outputCount = Math.floor(sampleCount * 16000 / sourceRate)
  const outputBytes = outputCount * 2
  if (!outputCount || outputBytes > MAX_AUDIO_BYTES)
    throw new Error('录音长度无效，单轮最多 64 秒 / 2 MiB')
  const output = new ArrayBuffer(outputBytes)
  const view = new DataView(output)
  for (let i = 0; i < outputCount; i++) {
    const position = i * sourceRate / 16000
    const left = Math.floor(position)
    const fraction = position - left
    const first = input[left] || 0
    const second = input[Math.min(left + 1, sampleCount - 1)] || 0
    const sample = Math.max(-1, Math.min(1, first + (second - first) * fraction))
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true)
  }
  return output
}

function measureInput(samples: Float32Array) {
  let squared = 0
  let peak = 0
  for (const sample of samples) {
    squared += sample * sample
    peak = Math.max(peak, Math.abs(sample))
  }
  inputRms.value = samples.length ? Math.sqrt(squared / samples.length) : 0
  inputPeak.value = peak
  // Reject only near-digital silence; a quiet voice or brief audible peak must still reach ASR.
  if (inputRms.value >= 0.00005 || peak >= 0.0005)
    inputSignalDetected.value = true
}

async function startH5Recorder(activeTurnId: string) {
  inputRms.value = 0
  inputPeak.value = 0
  inputSignalDetected.value = false
  const generation = ++recordingGeneration
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error('当前 WebView 不支持麦克风录音，请检查安全来源与麦克风权限')
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
  if (!pageActive || generation !== recordingGeneration || turnId !== activeTurnId) {
    stream.getTracks().forEach(track => track.stop())
    return
  }
  h5Stream = stream
  let context: AudioContext | undefined
  try {
    context = new AudioContext()
    h5AudioContext = context
    await context.resume()
    if (!pageActive || generation !== recordingGeneration || turnId !== activeTurnId) {
      stream.getTracks().forEach(track => track.stop())
      if (context.state !== 'closed')
        void context.close()
      if (h5Stream === stream)
        h5Stream = undefined
      if (h5AudioContext === context)
        h5AudioContext = undefined
      return
    }
    h5Source = context.createMediaStreamSource(stream)
    h5Processor = context.createScriptProcessor(4096, 1, 1)
    h5Mute = context.createGain()
    h5Mute.gain.value = 0
    h5Processor.onaudioprocess = (event) => {
      if (!recordingActive.value || generation !== recordingGeneration)
        return
      const channel = event.inputBuffer.getChannelData(0)
      const remaining = Math.max(0, context.sampleRate * MAX_AUDIO_SECONDS - h5SampleCount)
      const length = Math.min(channel.length, remaining)
      if (length > 0) {
        const samples = channel.slice(0, length)
        measureInput(samples)
        h5Chunks.push(samples)
        h5SampleCount += length
      }
      if (length < channel.length || h5SampleCount >= context.sampleRate * MAX_AUDIO_SECONDS)
        stopVoice()
    }
    h5Source.connect(h5Processor)
    h5Processor.connect(h5Mute)
    h5Mute.connect(context.destination)
    recordingActive.value = true
    voiceState.value = 'recording'
    h5DurationTimer = setTimeout(stopVoice, MAX_AUDIO_SECONDS * 1000)
  }
  catch (error) {
    if (context && generation === recordingGeneration && h5AudioContext === context) {
      releaseH5Recorder()
    }
    else {
      stream.getTracks().forEach(track => track.stop())
      if (context && context.state !== 'closed')
        void context.close()
      if (h5Stream === stream)
        h5Stream = undefined
      if (h5AudioContext === context)
        h5AudioContext = undefined
    }
    throw error
  }
}

function stopH5Recorder(discard: boolean) {
  if (!recordingActive.value) {
    recordingGeneration++
    releaseH5Recorder()
    return
  }
  const chunks = h5Chunks
  const sampleCount = h5SampleCount
  const sourceRate = h5AudioContext?.sampleRate ?? 0
  recordingActive.value = false
  recordingGeneration++
  releaseH5Recorder()
  if (discard || !pageActive || !socketReady) {
    sendJson({ type: 'input.cancel', turn_id: turnId })
    voiceState.value = 'idle'
    return
  }
  try {
    if (!inputSignalDetected.value)
      throw new Error('未检测到有效声音，本轮录音未发送。请检查 MuMu 宿主机是否有可用麦克风、是否选中正确输入设备及是否静音，再靠近麦克风重试。')
    const pcm = pcm16k(chunks, sampleCount, sourceRate)
    if (pcm.byteLength > MAX_AUDIO_BYTES)
      throw new Error('录音超过 2 MiB 限制')
    socket?.send({ data: pcm })
    sendJson({ type: 'input.end', turn_id: turnId })
    voiceState.value = 'processing'
  }
  catch (error) {
    sendJson({ type: 'input.cancel', turn_id: turnId })
    voiceError.value = error instanceof Error ? error.message : '录音数据无效'
    voiceState.value = 'idle'
  }
}
// #endif

// #ifdef APP-PLUS
function finishNativeRecording(event: { tempFilePath?: string }) {
  const filePath = event.tempFilePath || ''
  const stoppedTurnId = turnId
  const generation = recordingGeneration
  const wasRecording = recordingActive.value
  recordingActive.value = false
  recordingBytes = 0
  if (!pageActive || !wasRecording || discardCurrentInput.value || !socketReady) {
    if (filePath)
      uni.getFileSystemManager().unlink({ filePath })
    pcmFrames = []
    discardCurrentInput.value = false
    if (pageActive)
      voiceState.value = 'idle'
    return
  }
  const sendInput = (frames: ArrayBuffer[]) => {
    if (!pageActive || !socketReady || turnId !== stoppedTurnId || generation !== recordingGeneration) {
      voiceState.value = 'idle'
      return
    }
    if (!frames.length) {
      voiceError.value = '录音文件为空，请检查麦克风权限后重试'
      voiceState.value = 'idle'
      sendJson({ type: 'input.cancel', turn_id: stoppedTurnId })
      return
    }
    const size = frames.reduce((total, frame) => total + frame.byteLength, 0)
    if (size > MAX_AUDIO_BYTES) {
      voiceError.value = '录音超过 2 MiB 限制，请缩短后重试'
      voiceState.value = 'idle'
      sendJson({ type: 'input.cancel', turn_id: stoppedTurnId })
      return
    }
    for (const frame of frames)
      socket?.send({ data: frame })
    sendJson({ type: 'input.end', turn_id: stoppedTurnId })
    voiceState.value = 'processing'
  }
  if (pcmFrames.length) {
    const frames = pcmFrames
    pcmFrames = []
    sendInput(frames)
    if (filePath)
      uni.getFileSystemManager().unlink({ filePath })
    return
  }
  if (!filePath) {
    voiceError.value = '录音失败：设备没有返回录音分片或临时文件'
    voiceState.value = 'idle'
    return
  }
  voiceState.value = 'processing'
  uni.getFileSystemManager().readFile({
    filePath,
    success: ({ data }) => {
      uni.getFileSystemManager().unlink({ filePath })
      if (!pageActive || !socketReady || turnId !== stoppedTurnId || generation !== recordingGeneration)
        return
      if (!(data instanceof ArrayBuffer)) {
        voiceError.value = '无法读取录音临时文件'
        voiceState.value = 'idle'
        return
      }
      sendInput([data])
    },
    fail: () => {
      uni.getFileSystemManager().unlink({ filePath })
      if (pageActive && turnId === stoppedTurnId && generation === recordingGeneration) {
        voiceError.value = '无法读取录音临时文件'
        voiceState.value = 'idle'
      }
    },
  })
}
// #endif

function stopActiveRecording(discard: boolean) {
  discardCurrentInput.value = discard
  if (webAudioEnabled) {
    // #ifdef H5
    stopH5Recorder(discard)
    // #endif
    return
  }
  // #ifdef APP-PLUS
  if (recordingActive.value)
    recorder.stop()
  // #endif
}

function setupRecorder() {
  if (webAudioEnabled)
    return
  // #ifdef APP-PLUS
  recorder.onFrameRecorded((event: { frameBuffer: ArrayBuffer }) => {
    if (!pageActive || !recordingActive.value || discardCurrentInput.value || !socketReady || !(event.frameBuffer instanceof ArrayBuffer))
      return
    recordingBytes += event.frameBuffer.byteLength
    if (recordingBytes > MAX_AUDIO_BYTES) {
      voiceError.value = '录音超过 2 MiB 限制，请缩短后重试'
      stopActiveRecording(true)
      return
    }
    pcmFrames.push(event.frameBuffer)
  })
  nativeStopHandler = finishNativeRecording
  recorder.onStop(nativeStopHandler)
  recorder.onError(() => {
    if (!pageActive || !recordingActive.value)
      return
    recordingActive.value = false
    discardCurrentInput.value = false
    pcmFrames = []
    sendJson({ type: 'input.cancel', turn_id: turnId })
    voiceError.value = '录音失败，请检查麦克风权限后重试'
    voiceState.value = 'idle'
  })
  // #endif
}

async function ensureMicPermission() {
  // #ifdef APP-PLUS
  if (typeof plus !== 'undefined' && plus.android.requestPermissions) {
    await new Promise<void>((resolve, reject) => {
      plus.android.requestPermissions(['android.permission.RECORD_AUDIO'], (result: unknown) => {
        const granted = typeof result === 'object' && result !== null && 'granted' in result ? result.granted : undefined
        if (Array.isArray(granted) && granted.includes('android.permission.RECORD_AUDIO'))
          resolve()
        else
          reject(new Error('请在 MuMu 系统设置中允许麦克风权限'))
      }, () => reject(new Error('无法申请麦克风权限')))
    })
  }
  // #endif
}

async function startVoice() {
  if (!pageActive || recordingActive.value || voiceState.value !== 'idle' || resettingSession.value || microphoneTest.active.value || speakerTest.active.value)
    return
  duplex.stop()
  voiceState.value = 'connecting'
  const provider = voiceProvider.value
  voiceError.value = ''
  if (provider === 'seeduplex')
    voiceError.value = '豆包 SeedDuplex 3.0：网页端 PCM 或 App MP3 均由后端转换为 16k PCM。'
  transcript.value = ''
  answer.value = ''
  pcmFrames = []
  stopPlayback()
  playbackTurnId = ''
  turnId = `turn-${Date.now()}-${playbackGeneration}`
  const activeTurnId = turnId
  try {
    await ensureMicPermission()
    if (!pageActive || turnId !== activeTurnId || provider !== voiceProvider.value)
      return
    if (!socketReady)
      await openSocket()
    if (!pageActive || turnId !== activeTurnId || !socketReady)
      return
    discardCurrentInput.value = false
    if (webAudioEnabled) {
      // #ifdef H5
      await startH5Recorder(activeTurnId)
      // #endif
    }
    else {
      // #ifdef APP-PLUS
      recordingGeneration++
      recordingBytes = 0
      pcmFrames = []
      recordingActive.value = true
      voiceState.value = 'recording'
      recorder.start({ duration: MAX_AUDIO_SECONDS * 1000, sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 96000, format: 'mp3', frameSize: 4 } as UniApp.RecorderManagerStartOptions)
      // #endif
      // #ifndef APP-PLUS
      voiceError.value = '当前平台暂不支持语音录制'
      voiceState.value = 'idle'
      // #endif
    }
  }
  catch (error) {
    if (!pageActive || turnId !== activeTurnId)
      return
    recordingActive.value = false
    // #ifdef H5
    releaseH5Recorder()
    // #endif
    voiceError.value = micErrorMessage(error)
    voiceState.value = 'idle'
  }
}

function stopVoice() {
  if (recordingActive.value)
    stopActiveRecording(false)
}

function interruptVoice() {
  microphoneTest.cancel()
  speakerTest.cancel()
  sessionStats.stop()
  duplex.stop()
  cancelSessionReset()
  const activeTurnId = playbackTurnId || turnId
  stopPlayback()
  if (webAudioEnabled || recordingActive.value)
    stopActiveRecording(true)
  sendJson({ type: 'playback.interrupted', turn_id: activeTurnId })
  turnId = ''
  playbackTurnId = ''
  voiceState.value = 'idle'
}

async function toggleMicrophoneTest() {
  if (microphoneTest.active.value) {
    microphoneTest.finish()
    return
  }
  if (!pageActive || duplexActive.value || recordingActive.value || speakerTest.active.value || voiceState.value !== 'idle' || resettingSession.value)
    return
  voiceError.value = ''
  await microphoneTest.start(microphones.selectedDeviceId.value, (diagnostics) => {
    captureDiagnostics.value = diagnostics
    void microphones.refresh()
  })
}

async function toggleSpeakerTest() {
  if (speakerTest.active.value) {
    speakerTest.cancel()
    return
  }
  if (!pageActive || duplexActive.value || recordingActive.value || microphoneTest.active.value || voiceState.value !== 'idle' || resettingSession.value)
    return
  voiceError.value = ''
  await speakerTest.start(speakers.selectedDeviceId.value)
}

function interruptDuplexReply() {
  if (!duplexActive.value)
    return
  sessionStats.noteInterrupt()
  duplex.interrupt()
}

function toggleDuplexMute() {
  const next = !duplexMuted.value
  if (duplex.setMuted(next))
    sessionStats.setMuted(next)
}

async function runTask(action: string) {
  if (taskBusy.value)
    return
  taskBusy.value = action
  try {
    taskStatus.value = await startVoiceTask(action)
    voiceError.value = ''
  }
  catch (e) {
    voiceError.value = e instanceof Error ? e.message : '任务启动失败'
  }
  finally {
    taskBusy.value = null
    void refresh()
  }
}

async function refresh() {
  loading.value = !status.value
  try {
    const [nextStatus, nextTasks, nextTodos] = await Promise.all([getVoiceStatus(), getVoiceTasks(), getVoiceTodos()])
    status.value = nextStatus
    taskStatus.value = nextTasks
    todos.value = nextTodos
    error.value = ''
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : '无法连接 GoFrame 服务'
  }
  finally {
    loading.value = false
  }
}

async function toggle(item: NonNullable<TodoSummary['items']>[number]) {
  if (updating.value !== null)
    return
  updating.value = item.id
  try {
    todos.value = await setVoiceTodo(item.id, !item.completed)
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : '更新 TODO 失败'
  }
  finally {
    updating.value = null
  }
}

watch(duplexState, (next) => {
  if (next === 'listening') {
    reconnect.markConnected()
    quality.start()
    sessionStats.start()
  }
})

watch(reconnect.attempt, (next, previous) => {
  if (next > previous) {
    quality.noteReconnect()
    diagnosticTimeline.add('reconnect.attempt', { value: next })
  }
})

watch(congested, (next, previous) => {
  if (next && !previous) {
    quality.noteCongestion()
    diagnosticTimeline.add('audio.congested')
  }
  else if (!next && previous) {
    diagnosticTimeline.add('audio.recovered')
  }
})

watch(duplexErrorCode, (code) => {
  if (code)
    diagnosticTimeline.add('session.error', { code })
  if (duplexRequested && pageActive && recoverableDuplexErrors.has(code))
    reconnect.schedule(connectDuplex)
  else if (code)
    sessionStats.stop()
})

watch(reconnect.online, (online) => {
  diagnosticTimeline.add(online ? 'network.online' : 'network.offline')
  if (!online && duplexRequested && duplexActive.value) {
    sessionStats.stop()
    duplex.stop()
    reconnect.schedule(connectDuplex)
  }
})

// #ifdef H5
function handleVisibilityChange() {
  if (document.hidden) {
    duplexRequested = false
    reconnect.cancel()
    quality.stop()
    sessionStats.stop()
    interruptVoice()
    portraitQueue.cancelAll()
  }
}
// #endif

onHide(() => {
  duplexRequested = false
  reconnect.cancel()
  quality.stop()
  sessionStats.stop()
  interruptVoice()
  portraitQueue.cancelAll()
  speakerTest.cancel()
})
onMounted(() => {
  pageActive = true
  reconnect.start()
  microphones.start()
  speakers.start()
  companionPrivacy.refresh()
  // #ifdef H5
  duplexSupported.value = supportsDuplexCapture()
  // #endif
  setupRecorder()
  // #ifdef H5
  document.addEventListener('visibilitychange', handleVisibilityChange)
  // #endif
  void refresh()
  timer = setInterval(() => void refresh(), 5000)
})
onUnmounted(() => {
  duplexRequested = false
  reconnect.stop()
  quality.stop()
  sessionStats.stop()
  microphones.stop()
  speakers.stop()
  microphoneTest.cancel()
  speakerTest.dispose()
  duplex.stop()
  portraitQueue.cancelAll()
  cancelSessionReset()
  pageActive = false
  recordingGeneration++
  socketGeneration++
  cancelConnection?.()
  cancelConnection = undefined
  turnId = ''
  playbackTurnId = ''
  discardCurrentInput.value = true
  pcmFrames = []
  stopPlayback()
  // #ifdef H5
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  stopH5Recorder(true)
  // #endif
  if (timer)
    clearInterval(timer)
  if (recordingActive.value)
    stopActiveRecording(true)
  recordingActive.value = false
  socketReady = false
  const previous = socket
  socket = undefined
  previous?.close({ code: 1000, reason: 'page leave' })
})
</script>

<template>
  <view data-testid="companion-page" class="voice-page">
    <view class="page-head">
      <view>
        <text class="eyebrow">AI COMPANION CALL</text>
        <text class="page-title">AI 陪伴通话</text>
      </view>
      <button class="refresh" :disabled="loading" aria-label="刷新状态" @tap="refresh">
        <view class="i-carbon-renew text-20px" />
      </button>
    </view>

    <view v-if="error" class="notice" role="status">
      {{ error }}
      <text class="retry" @tap="refresh">重试</text>
    </view>

    <view v-if="voiceError || duplexError" class="voice-error" role="alert">
      {{ duplexError || voiceError }}
    </view>

    <view class="mb-24rpx rounded-12rpx bg-white p-24rpx">
      <text class="section-title">陪伴角色 · {{ profile.displayName }}</text>
      <AvatarRenderer :model-id="profile.avatarModelId" :face-src="face?.src" :portrait-src="portrait?.imageUrl" :pose-id="profile.poseId" :outfit-id="profile.outfitId" :outfit-library="profile.outfitLibrary" :speaking="duplexState === 'playing' || voiceState === 'playing'" :audio-level="avatarLevel" />
      <view class="flex flex-wrap gap-16rpx">
        <picker :range="CHARACTERS" range-key="label" @change="chooseCharacter(Number($event.detail.value))">
          <button class="provider-option">
            切换角色
          </button>
        </picker>
        <picker :range="FACES" range-key="label" @change="selectFace(Number($event.detail.value))">
          <button class="provider-option">
            人脸：{{ face?.label }}
          </button>
        </picker>
        <picker :range="OUTFITS" range-key="label" @change="selectOutfit(Number($event.detail.value))">
          <button class="provider-option">
            服装：{{ outfit?.label }}
          </button>
        </picker>
        <picker :range="POSES" range-key="label" @change="selectPose(Number($event.detail.value))">
          <button class="provider-option">
            姿势：{{ POSES.find(item => item.id === profile.poseId)?.label }}
          </button>
        </picker>
      </view>
      <text v-if="assetError" class="block text-red-700" role="alert">{{ assetError }}</text>
      <view class="preset-panel mt-16rpx">
        <input v-model="presetName" data-testid="preset-name" class="archive-search" :maxlength="30" placeholder="预设名称（可选）">
        <button data-testid="save-preset" class="diagnostic-action mt-12rpx" @tap="saveCharacterPreset">
          保存当前造型（最多 10 个）
        </button>
        <picker v-if="characterPresets.entries.value.length" :range="characterPresets.entries.value" range-key="label" @change="applyCharacterPreset(Number($event.detail.value))">
          <button data-testid="apply-preset" class="diagnostic-action mt-12rpx">
            应用预设：{{ selectedPreset?.label || '请选择' }}
          </button>
        </picker>
        <template v-if="selectedPreset">
          <input v-model="presetEditName" class="archive-search" :maxlength="30" placeholder="所选预设的新名称">
          <view class="runtime-actions">
            <button class="diagnostic-action" @tap="renameSelectedPreset">
              重命名
            </button>
            <button class="diagnostic-action" :disabled="characterPresets.entries.value.length >= 10" @tap="copySelectedPreset">
              复制预设
            </button>
            <button class="diagnostic-action danger" @tap="removeSelectedPreset">
              删除预设
            </button>
          </view>
        </template>
        <button v-if="lastRemovedPreset" class="diagnostic-action mt-12rpx" @tap="undoPresetRemoval">
          撤销删除“{{ lastRemovedPreset.label }}”
        </button>
      </view>
      <button class="provider-option mt-16rpx" :disabled="portraitQueue.full.value" @tap="enqueuePortrait">
        {{ portraitQueue.size.value ? `写真队列 ${portraitQueue.size.value}/3（语音可继续）` : '生成高清写真' }}
      </button>
      <button v-if="portraitQueue.size.value" class="provider-option" @tap="portraitQueue.cancelAll()">
        取消全部写真任务
      </button>
      <button v-if="portrait" class="provider-option" @tap="releaseCurrentPortrait">
        释放当前高清写真
      </button>
      <text v-if="portraitError" class="block text-red-700" role="alert">{{ portraitError }}</text>
      <view v-if="portraitGallery.length" class="archive-results mt-12rpx">
        <view class="flex items-center justify-between">
          <text class="runtime-line">最近成功写真（仅当前运行）</text>
          <button class="diagnostic-action" @tap="portraitQueue.clearHistory()">
            释放结果
          </button>
        </view>
        <view class="portrait-gallery">
          <view v-for="item in portraitGallery" :key="item.id" class="portrait-card" @tap="showPortraitResult(item)">
            <image class="portrait-thumb" :src="item.result.imageUrl" mode="aspectFill" />
            <text class="archive-result-text">{{ portraitSnapshotLabel(item.payload) }}</text>
          </view>
        </view>
      </view>
      <view v-if="portraitQueue.history.value.length" class="archive-results mt-12rpx">
        <text class="runtime-line">最近写真任务（本次打开期间）</text>
        <view v-for="item in portraitQueue.history.value.slice(0, 5)" :key="item.id" class="archive-result">
          <text class="archive-result-text">{{ portraitHistoryTime(item.completedAt) }} · {{ portraitHistoryLabel(item.status) }}</text>
          <button v-if="item.status !== 'success'" class="diagnostic-action mt-12rpx" :disabled="portraitQueue.full.value" @tap="retryPortrait(item.id)">
            重新生成
          </button>
        </view>
      </view>
      <text class="live-hint">动态 2D 运行时提供音量驱动嘴型、眨眼、呼吸与摆动；这是音量嘴型，不是音素级唇形。系统开启“减少动态”或资产异常时会自动降级。语音示例：换成 12 号衣服、换成自然站姿。</text>
    </view>
    <view class="live-hint mb-24rpx">
      <text class="block">选择豆包后点“开始双方通话”，允许麦克风即可持续聊天；对方说话时可直接插话。</text>
      <button class="provider-option mt-16rpx" :disabled="duplexActive || recordingActive || microphoneTest.active.value || voiceState !== 'idle'" @tap="openSettings">
        配置后端与语音 Key
      </button>
    </view>
    <view class="live-panel">
      <view class="provider-switch">
        <text class="provider-label">语音引擎</text>
        <view class="provider-options flex flex-wrap gap-16rpx">
          <button class="provider-option" :class="{ active: voiceProvider === 'local' }" :disabled="recordingActive || resettingSession || microphoneTest.active.value || voiceState !== 'idle'" :aria-pressed="voiceProvider === 'local'" @tap="selectProvider('local')">
            本地 Qwen
          </button>
          <button data-testid="provider-seeduplex" class="provider-option" :class="{ active: voiceProvider === 'seeduplex' }" :disabled="recordingActive || resettingSession || microphoneTest.active.value || voiceState !== 'idle'" :aria-pressed="voiceProvider === 'seeduplex'" @tap="selectProvider('seeduplex')">
            豆包 SeedDuplex 3.0
          </button>
          <button class="provider-option" :class="{ active: voiceProvider === 'open-llm-vtuber' }" :disabled="recordingActive || resettingSession || microphoneTest.active.value || voiceState !== 'idle'" :aria-pressed="voiceProvider === 'open-llm-vtuber'" @tap="selectProvider('open-llm-vtuber')">
            Open-LLM-VTuber
          </button>
        </view>
      </view>
      <text v-if="voiceProvider === 'open-llm-vtuber'" class="live-hint">请先在后端同一主机启动 Open-LLM-VTuber 并配置其 ASR、LLM、TTS；本页接入语音和文本；该引擎的人设与音色由外部配置控制，页面角色选择只更新静态形象。</text>

      <view>
        <text class="section-title">实时语音对话</text>
        <text class="live-state">{{ duplexActive ? (duplexMuted ? '通话静音中，连接保持' : duplexState === 'playing' ? 'AI 正在说话，可直接插话' : duplexState === 'connecting' ? '通话连接中' : '免提通话中，麦克风持续采集') : recordingActive ? '麦克风持续采集中' : voiceState === 'recording' ? '正在录音' : voiceState === 'processing' ? '识别与生成中' : voiceState === 'playing' ? '正在播放' : voiceState === 'connecting' ? '连接中' : '点击开始说话' }}</text>
      </view>
      <view class="live-dot" :class="voiceState" />
    </view>
    <view v-if="voiceProvider === 'seeduplex'" class="mb-24rpx" role="status" aria-live="polite">
      <button v-if="duplexActive" class="duplex-button voice-button" @tap="stopDuplex">
        结束通话
      </button>
      <button v-else-if="duplexSupported" class="duplex-button voice-button" :disabled="voiceState !== 'idle' || recordingActive || microphoneTest.active.value || speakerTest.active.value" @tap="startDuplex">
        开始双方通话 · 持续开麦
      </button>
      <text v-else class="live-hint">duplex_not_supported：当前设备不支持免提通话，可使用下方按轮录音；Android 请安装带原生通话能力的新版本。</text>
      <text v-if="duplexActive" class="live-hint">{{ duplexMuted ? '麦克风已静音，不发送上行音频；连接与 AI 播放保持。' : congested ? '网络拥塞，暂停发送音频' : duplexState === 'connecting' ? '正在连接' : duplexState === 'playing' ? 'AI 正在说话，可以直接插话' : duplexState === 'speaking' ? '正在聆听你的话' : duplexState === 'thinking' ? '正在生成回复' : '通话中，持续聆听' }}</text>
      <text class="live-hint">检测到回声时建议佩戴耳机；扬声器免提依赖系统回声消除。</text>
      <button v-if="duplexActive" class="provider-option" :disabled="duplexState === 'connecting'" @tap="duplex.reset()">
        清空通话记忆
      </button>
      <button v-if="duplexActive" class="provider-option" @tap="interruptDuplexReply">
        停止当前回复
      </button>
      <button v-if="duplexActive" class="provider-option" :class="{ active: duplexMuted }" :disabled="duplexState === 'connecting'" :aria-pressed="duplexMuted" @tap="toggleDuplexMute">
        {{ duplexMuted ? '恢复麦克风' : '静音麦克风' }}
      </button>
      <!-- #ifdef H5 -->
      <picker v-if="microphones.available" :range="microphones.devices.value" range-key="label" @change="selectMicrophone(Number($event.detail.value))">
        <button class="provider-option mt-12rpx" :disabled="duplexState === 'connecting' || microphoneTest.active.value">
          麦克风：{{ selectedMicrophoneLabel }}
        </button>
      </picker>
      <picker v-if="speakers.available" :range="speakers.devices.value" range-key="label" @change="selectSpeaker(Number($event.detail.value))">
        <button class="provider-option mt-12rpx" :disabled="duplexState === 'connecting' || speakerTest.active.value">
          输出：{{ selectedSpeakerLabel }}
        </button>
      </picker>
      <!-- #endif -->
      <view v-if="reconnect.status.value !== 'idle'" class="reconnect-panel">
        <text class="live-hint">{{ reconnectText }}</text>
        <button class="diagnostic-action" @tap="retryDuplexNow">
          立即重试
        </button>
        <button class="diagnostic-action" @tap="cancelDuplexReconnect">
          取消重连
        </button>
      </view>
    </view>
    <view class="reconnect-panel microphone-test-panel" role="status" aria-live="polite">
      <view class="runtime-head">
        <text class="section-title">通话前麦克风试音</text>
        <text class="small-status">仅本地分析</text>
      </view>
      <text class="runtime-line">{{ microphoneTestMessage }}</text>
      <text v-if="microphoneTest.status.value !== 'idle'" class="runtime-line">{{ microphoneTest.levelText.value }}</text>
      <button class="diagnostic-action mt-12rpx" :disabled="duplexActive || recordingActive || speakerTest.active.value || resettingSession || voiceState !== 'idle'" @tap="toggleMicrophoneTest">
        {{ microphoneTest.active.value ? '结束试音' : '开始 8 秒试音' }}
      </button>
    </view>
    <view class="reconnect-panel microphone-test-panel" role="status" aria-live="polite">
      <view class="runtime-head">
        <text class="section-title">通话前扬声器试音</text>
        <text class="small-status">纯本地提示音</text>
      </view>
      <text class="runtime-line">{{ speakerTestMessage }}</text>
      <button class="diagnostic-action mt-12rpx" :disabled="duplexActive || recordingActive || microphoneTest.active.value || resettingSession || voiceState !== 'idle'" @tap="toggleSpeakerTest">
        {{ speakerTest.active.value ? '停止提示音' : '播放提示音' }}
      </button>
    </view>
    <view v-if="!duplexActive" class="voice-actions">
      <button v-if="recordingActive" class="voice-button recording" @tap="stopVoice">
        <view class="i-carbon-stop-filled text-22px" />
        <text>结束录音</text>
      </button>
      <button v-else class="voice-button" :disabled="resettingSession || microphoneTest.active.value || speakerTest.active.value || voiceState === 'connecting' || voiceState === 'processing' || voiceState === 'playing'" @tap="startVoice">
        <view class="i-carbon-microphone text-22px" />
        <text>{{ voiceState === 'processing' ? '处理中' : voiceState === 'playing' ? '播放中' : '开始说话' }}</text>
      </button>
      <button v-if="voiceState === 'recording' || voiceState === 'processing' || voiceState === 'playing'" class="interrupt-button" @tap="interruptVoice">
        打断
      </button>
    </view>
    <!-- #ifdef H5 -->
    <view v-if="(recordingActive || duplexActive) && webAudioEnabled" class="mic-diagnostics live-hint" role="status">
      <text v-if="duplexActive" class="block">RMS {{ Math.max(-100, 20 * Math.log10(duplexRms)).toFixed(0) }} dBFS · 峰值 {{ Math.max(-100, 20 * Math.log10(duplexPeak)).toFixed(0) }} dBFS</text>
      <text v-else class="block">{{ inputLevelText }}</text>
      <text v-if="(duplexActive ? duplexRms : inputRms) >= 0.00005 || (duplexActive ? duplexPeak : inputPeak) >= 0.0005">检测到输入信号；请继续说话，音量不代表识别成功。</text>
      <text v-else>当前未检测到声音或输入极小，请检查 MuMu 宿主机麦克风、输入设备与静音设置。{{ inputSignalDetected ? '本轮此前已检测到信号。' : '' }}</text>
    </view>
    <!-- #endif -->
    <!-- #ifdef APP-PLUS -->
    <text v-if="recordingActive && !webAudioEnabled" class="live-hint">原生录音器不提供实时采样音量；请确认 MuMu 宿主机麦克风和输入设备可用，录音结束后再检查识别结果。</text>
    <!-- #endif -->
    <view v-if="voiceProvider === 'local'" class="live-hint">
      <text class="block">当前连接保留最近 6 轮、最多 6000 字符的会话记忆，重新连接后清空。</text>
      <button class="reset-session" :disabled="voiceState !== 'idle' || recordingActive || resettingSession" @tap="resetSession">
        {{ resettingSession ? '正在清空记忆' : '清空会话记忆' }}
      </button>
      <text v-if="sessionNotice" role="status">{{ sessionNotice }}</text>
    </view>
    <view v-if="displayedTranscript" class="dialogue-row">
      <text class="dialogue-label">我</text>
      <text class="dialogue-text">{{ displayedTranscript }}</text>
    </view>
    <view v-if="displayedAnswer" class="dialogue-row answer-row">
      <text class="dialogue-label assistant">AI</text>
      <text class="dialogue-text">{{ displayedAnswer }}</text>
    </view>
    <text class="live-hint">MuMu Android：请先在系统设置允许麦克风权限，并将后端地址设为宿主机可达地址。</text>

    <view class="runtime-panel">
      <view class="runtime-head">
        <text class="section-title">运行诊断与隐私</text>
        <text class="small-status">仅保存在本机</text>
      </view>
      <text class="runtime-line">网络：{{ reconnect.online.value ? '在线' : '离线' }}</text>
      <text class="runtime-line">重连：{{ reconnectText }}</text>
      <text class="runtime-line">通话质量：{{ quality.grade.value }} · {{ quality.durationSeconds.value }} 秒 · 重连 {{ quality.reconnects.value }} 次 · 拥塞 {{ quality.congestionEvents.value }} 次</text>
      <text class="runtime-line">当前通话：{{ sessionStats.durationSeconds.value }} 秒 · 回合 {{ sessionStats.turns.value }} 次 · 主动打断 {{ sessionStats.interrupts.value }} 次 · 静音 {{ sessionStats.mutedSeconds.value }} 秒</text>
      <text class="runtime-line">延迟：连接 {{ latency.metrics.value.connectMs ?? '—' }} ms · 首字幕 {{ latency.metrics.value.firstTranscriptMs ?? '—' }} ms · 首音频 {{ latency.metrics.value.firstAudioMs ?? '—' }} ms · 回合 {{ latency.metrics.value.turnCompleteMs ?? '—' }} ms</text>
      <text class="runtime-line">输入：{{ selectedMicrophoneLabel }}</text>
      <text class="runtime-line">输出：{{ selectedSpeakerLabel }}</text>
      <text class="runtime-line">音频处理：{{ echoAdvice }}</text>
      <text class="runtime-line">通话前自检：{{ readiness.ready ? (readiness.warningCount ? `可开始，${readiness.warningCount} 项提醒` : '全部通过') : '存在阻断项' }}</text>
      <view class="readiness-list">
        <text v-for="item in readiness.checks" :key="item.key" class="readiness-item" :class="item.ok ? 'check-ok' : 'check-warning'">
          {{ item.ok ? '✓' : '!' }} {{ item.label }}
        </text>
      </view>
      <view v-if="diagnosticTimeline.entries.value.length" class="archive-results">
        <view class="flex items-center justify-between">
          <text class="runtime-line">最近状态事件（仅当前运行）</text>
          <button class="diagnostic-action" @tap="diagnosticTimeline.clear()">
            清空事件
          </button>
        </view>
        <text v-for="item in diagnosticTimeline.entries.value.slice(0, 8)" :key="item.id" class="archive-result-text">
          {{ portraitHistoryTime(item.at) }} · {{ item.type }}{{ item.code ? ` · ${item.code}` : '' }}{{ item.value !== undefined ? ` · ${item.value}` : '' }}
        </text>
      </view>
      <view v-if="avatarToolAudit.length" class="archive-results">
        <view class="flex items-center justify-between">
          <text class="runtime-line">角色工具调用审计（仅当前运行）</text>
          <button class="diagnostic-action" @tap="character.clearToolAudit()">
            清空审计
          </button>
        </view>
        <text v-for="item in avatarToolAudit.slice(0, 8)" :key="item.id" class="archive-result-text">
          {{ portraitHistoryTime(item.at) }} · {{ item.source }} · {{ item.name }} · {{ item.status }} · {{ item.code }}
        </text>
      </view>
      <text class="runtime-line">{{ profile.displayName }}的本地记录：{{ characterArchive.length }} 条；全部角色：{{ archive.entries.value.length }} 条</text>
      <input v-model="archiveQuery" class="archive-search" :maxlength="100" placeholder="搜索当前角色的本地对话">
      <button v-if="lastRemovedConversation" class="diagnostic-action undo-conversation mt-12rpx" @tap="undoConversationRemoval">
        撤销刚才的删除
      </button>
      <button class="diagnostic-action mt-12rpx" :aria-pressed="archiveFavoritesOnly" @tap="archiveFavoritesOnly = !archiveFavoritesOnly">
        {{ archiveFavoritesOnly ? '显示全部记录' : `仅看收藏（${characterFavoriteCount}）` }}
      </button>
      <picker :range="retentionOptions" range-key="label" @change="selectRetention(Number($event.detail.value))">
        <button class="diagnostic-action mt-12rpx">
          记录期限：{{ retentionLabel }}
        </button>
      </picker>
      <view v-if="characterArchive.length" class="archive-results">
        <text class="runtime-line">{{ archiveQuery.trim() ? '找到' : '最近' }} {{ archiveMatches.length }} 条</text>
        <text v-if="archiveFavoritesOnly && archiveMatches.length === 0" class="archive-result-text">当前筛选下没有收藏记录。</text>
        <view v-for="item in archiveMatches" :key="item.id" class="archive-result">
          <text v-if="item.favorite" class="archive-result-text">★ 已收藏</text>
          <text class="archive-result-text">我：{{ item.userText || '（无文字）' }}</text>
          <text class="archive-result-text">AI：{{ item.assistantText || '（无文字）' }}</text>
          <button class="diagnostic-action mt-12rpx" :aria-pressed="item.favorite === true" @tap="toggleConversationFavorite(item.id)">
            {{ item.favorite ? '取消收藏' : '收藏这条记录' }}
          </button>
          <button class="diagnostic-action danger mt-12rpx" @tap="removeConversationEntry(item.id)">
            删除这条记录
          </button>
        </view>
      </view>
      <view class="runtime-actions">
        <button class="diagnostic-action" @tap="copyCallSessionSummary">
          复制本次通话摘要
        </button>
        <button class="diagnostic-action" @tap="copyDiagnosticReport">
          复制脱敏诊断
        </button>
        <button class="diagnostic-action" @tap="copyCompanionBackup">
          复制完整备份
        </button>
        <button class="diagnostic-action" @tap="exportCompanionBackupFile">
          导出备份文件
        </button>
        <button class="diagnostic-action" @tap="importCompanionBackup">
          从剪贴板恢复备份
        </button>
        <button class="diagnostic-action" @tap="importCompanionBackupFile">
          从文件恢复备份
        </button>
        <button class="diagnostic-action" :disabled="archive.entries.value.length === 0" @tap="exportConversationArchive">
          复制记录 JSON
        </button>
        <button class="diagnostic-action" :disabled="favoriteConversationCount === 0" @tap="exportFavoriteConversationArchive">
          复制收藏 JSON（{{ favoriteConversationCount }}）
        </button>
        <button class="diagnostic-action" :disabled="archive.entries.value.length === 0" @tap="exportConversationArchiveFile('all')">
          下载全部记录 JSON
        </button>
        <button class="diagnostic-action" :disabled="favoriteConversationCount === 0" @tap="exportConversationArchiveFile('favorites')">
          下载收藏记录 JSON
        </button>
        <button class="diagnostic-action" @tap="importConversationArchive">
          导入记录 JSON
        </button>
        <button class="diagnostic-action danger" :disabled="unfavoritedConversationCount === 0" @tap="clearUnfavoritedConversations">
          清理未收藏（{{ unfavoritedConversationCount }}）
        </button>
        <button class="diagnostic-action" :disabled="characterArchive.length === 0" @tap="clearConversationArchive(false)">
          清除当前角色
        </button>
        <button class="diagnostic-action danger" :disabled="archive.entries.value.length === 0" @tap="clearConversationArchive(true)">
          清除全部
        </button>
      </view>
      <text class="privacy-note">完整备份仅在你主动点击时写入剪贴板；会排除 Key、音频、设备 ID、生成图片和第三方 URL。</text>
      <text class="runtime-line mt-12rpx">陪伴模块本机占用：{{ companionPrivacy.summary.value.entries }} 项，约 {{ companionPrivacy.summary.value.bytes }} 字节</text>
      <view class="readiness-list">
        <text v-for="category in companionPrivacy.summary.value.categories" :key="category.key" class="readiness-item">
          {{ category.label }}：{{ category.entries }} 项 · 约 {{ category.bytes }} 字节
        </text>
      </view>
      <text class="runtime-line" :class="companionPrivacy.summary.value.status === 'healthy' ? 'check-ok' : 'check-warning'">存储健康：{{ companionPrivacy.summary.value.message }}</text>
      <view class="runtime-actions">
        <button class="diagnostic-action" @tap="companionPrivacy.refresh()">
          刷新占用统计
        </button>
        <button class="diagnostic-action danger" @tap="clearCompanionData">
          清除全部陪伴数据
        </button>
      </view>
    </view>
  </view>

  <view class="task-panel">
    <view class="section-title-row task-title-row">
      <text class="section-title">模型与服务准备</text>
      <text class="small-status">{{ taskStatus?.huggingface_token_configured || taskStatus?.modelscope_token_configured || taskStatus?.seeduplex_api_key_configured ? '令牌已配置' : '未检测到令牌' }}</text>
    </view>
    <text class="task-note">令牌只从后端进程环境读取，不会显示具体内容、写入 MySQL 或传给 App。</text>
    <view v-for="task in taskStatus?.tasks ?? []" :key="task.action" class="task-row">
      <view class="task-main">
        <text class="task-name">{{ taskLabels[task.action] || task.action }}</text>
        <text class="task-message">{{ task.message }}</text>
      </view>
      <view v-if="task.running || task.action.startsWith('download-')" class="task-progress">
        <view class="track">
          <view class="fill" :style="{ width: `${task.progress}%` }" />
        </view>
        <text class="task-percent">{{ task.progress }}%</text>
      </view>
      <button v-if="!task.running && !task.success" class="task-button" :disabled="taskBusy !== null" @tap="runTask(task.action)">
        {{ task.action.startsWith('download-') ? '下载' : '启动' }}
      </button>
      <text v-else-if="task.success" class="task-ready">已完成</text>
    </view>
  </view>

  <view class="overview">
    <view class="overview-row">
      <view>
        <text class="section-label">整体完成度</text>
        <text class="percent">{{ todos?.progress ?? 0 }}%</text>
      </view>
      <text class="count">{{ todos?.completed ?? 0 }} / {{ todos?.total ?? 5 }} 项</text>
    </view>
    <view class="track">
      <view class="fill" :style="{ width: `${todos?.progress ?? 0}%` }" />
    </view>
    <text class="supporting">按部署、接入与验证步骤统计，勾选状态保存在 GoFrame MySQL TODO 表中。</text>
  </view>

  <view class="section-title-row">
    <text class="section-title">模型下载与本地服务</text>
    <text class="small-status">{{ status?.download_progress ?? 0 }}% 就绪</text>
  </view>
  <view class="model-list">
    <view v-for="model in status?.models ?? []" :key="model.name" class="model-row">
      <view class="model-top">
        <text class="model-name">{{ model.name }}</text>
        <text class="model-state" :class="model.exists ? 'ready' : 'missing'">{{ model.exists ? '已就绪' : '待下载' }}</text>
      </view>
      <view class="track model-track">
        <view class="fill" :style="{ width: `${model.progress}%` }" />
      </view>
      <text class="path">{{ model.path }}</text>
      <text v-if="model.message" class="path">{{ model.message }}</text>
    </view>
  </view>

  <view class="section-title-row service-heading">
    <text class="section-title">服务健康状态</text>
    <text class="small-status">每 5 秒更新</text>
  </view>
  <view class="service-list">
    <view v-for="component in status?.components ?? []" :key="component.name" class="service-row">
      <view class="service-dot" :class="component.available ? 'online' : 'offline'" />
      <text class="service-name">{{ component.name }}</text>
      <text class="service-state">{{ component.message || (component.available ? '运行中' : '未连接') }}</text>
    </view>
  </view>

  <view class="section-title-row todo-heading">
    <text class="section-title">实施清单</text>
    <text class="small-status">{{ pending.length }} 项待完成</text>
  </view>
  <view v-if="pending.length" class="todo-list">
    <view v-for="item in pending" :key="item.id" class="todo-row" @tap="toggle(item)">
      <view class="checkbox" :class="{ disabled: updating === item.id }" />
      <text class="todo-text">{{ item.title }}</text>
    </view>
  </view>
  <view v-else class="empty">
    所有实施任务均已完成
  </view>

  <view v-if="completed.length" class="completed-block">
    <text class="completed-title">已完成 · {{ completed.length }}</text>
    <view v-for="item in completed" :key="item.id" class="todo-row done" @tap="toggle(item)">
      <view class="checkbox checked">
        <view class="i-carbon-checkmark text-14px" />
      </view>
      <text class="todo-text">{{ item.title }}</text>
    </view>
  </view>

  <text class="privacy-note">仅检查配置指定的模型路径及本机服务端口。不会扫描其它本机文件、数据库内容或用户资料。</text>
</template>

<style scoped>
.reconnect-panel,
.runtime-panel {
  margin-top: 20rpx;
  padding: 20rpx;
  border: 1px solid #d8e5e3;
  border-radius: 10rpx;
  background: #fff;
}
.runtime-panel {
  margin-bottom: 24rpx;
}
.runtime-head,
.runtime-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12rpx;
}
.archive-search {
  min-height: 64rpx;
  margin-top: 14rpx;
  padding: 0 18rpx;
  border: 1px solid #d8e5e3;
  border-radius: 8rpx;
  background: #f9fbfb;
  font-size: 22rpx;
}
.archive-result {
  margin-top: 12rpx;
  padding-top: 10rpx;
  border-top: 1px solid #e8eeee;
}
.archive-result-text {
  display: block;
  overflow-wrap: anywhere;
  color: #46565a;
  font-size: 20rpx;
  line-height: 1.5;
}
.portrait-gallery {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12rpx;
  margin-top: 12rpx;
}
.portrait-card {
  overflow: hidden;
  border: 1px solid #d8e5e3;
  border-radius: 10rpx;
  background: #fff;
}
.portrait-thumb {
  display: block;
  width: 100%;
  height: 220rpx;
  background: #eef4f3;
}
.portrait-card .archive-result-text {
  padding: 10rpx;
}
.readiness-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx 14rpx;
  margin-top: 10rpx;
}
.readiness-item {
  font-size: 19rpx;
}
.check-ok {
  color: #15715e;
}
.check-warning {
  color: #9b5a17;
}
.runtime-head {
  justify-content: space-between;
  margin-bottom: 14rpx;
}
.runtime-line {
  display: block;
  color: #46565a;
  font-size: 21rpx;
  line-height: 1.55;
}
.runtime-actions {
  margin-top: 16rpx;
}
.diagnostic-action {
  min-height: 54rpx;
  margin: 0;
  padding: 0 18rpx;
  border: 1px solid #167d77;
  border-radius: 8rpx;
  background: #fff;
  color: #167d77;
  font-size: 20rpx;
}
.diagnostic-action::after {
  border: 0;
}
.diagnostic-action[disabled] {
  opacity: 0.42;
}
.diagnostic-action.danger {
  border-color: #bd4b42;
  color: #8f3731;
}
.provider-option {
  min-height: 96rpx;
  margin: 0;
  padding: 12rpx 20rpx;
  border: 1px solid #167d77;
  border-radius: 10rpx;
  background: #fff;
  color: #167d77;
  font-size: 25rpx;
}
.provider-option::after {
  border: 0;
}
.provider-option.active {
  background: #167d77;
  color: #fff;
}
.provider-option[disabled] {
  opacity: 0.48;
}
.task-panel {
  margin-bottom: 28rpx;
  padding: 24rpx;
  border: 1px solid #e0e5e6;
  border-radius: 10rpx;
  background: #fff;
}
.task-title-row {
  margin: 0 0 10rpx;
}
.task-note {
  display: block;
  margin-bottom: 16rpx;
  color: #59676b;
  font-size: 20rpx;
  line-height: 1.5;
}
.task-row {
  display: flex;
  min-height: 80rpx;
  align-items: center;
  gap: 14rpx;
  border-top: 1px solid #edf0f1;
}
.task-main {
  flex: 1;
  min-width: 0;
}
.task-name,
.task-message {
  display: block;
  overflow-wrap: anywhere;
}
.task-name {
  font-size: 22rpx;
  font-weight: 700;
}
.task-message {
  margin-top: 4rpx;
  color: #59676b;
  font-size: 19rpx;
}
.task-progress {
  display: flex;
  width: 170rpx;
  align-items: center;
  gap: 8rpx;
}
.task-progress .track {
  flex: 1;
  height: 8rpx;
  margin-top: 0;
}
.task-percent {
  width: 52rpx;
  color: #167d77;
  font-size: 18rpx;
  text-align: right;
}
.task-button {
  width: 104rpx;
  min-height: 52rpx;
  margin: 0;
  border: 1px solid #167d77;
  border-radius: 8rpx;
  background: #fff;
  color: #167d77;
  font-size: 20rpx;
}
.task-button::after {
  border: 0;
}
.task-button[disabled] {
  opacity: 0.45;
}
.task-ready {
  width: 104rpx;
  color: #15715e;
  font-size: 20rpx;
  text-align: center;
}
.voice-error {
  margin-bottom: 20rpx;
  padding: 18rpx;
  border-left: 6rpx solid #bd4b42;
  background: #fff0ee;
  color: #752d28;
  font-size: 23rpx;
  line-height: 1.5;
}
.live-panel {
  margin-bottom: 28rpx;
  padding: 26rpx;
  border: 1px solid #cfe1df;
  border-radius: 12rpx;
  background: #f2faf8;
}
.live-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.live-state {
  display: block;
  margin-top: 8rpx;
  color: #59676b;
  font-size: 22rpx;
}
.live-dot {
  width: 22rpx;
  height: 22rpx;
  border-radius: 50%;
  background: #a9b3b4;
}
.live-dot.recording {
  background: #c64b48;
  box-shadow: 0 0 0 10rpx #f7d9d8;
}
.live-dot.processing {
  background: #b37a1c;
}
.live-dot.playing {
  background: #167d77;
}
.voice-actions {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-top: 24rpx;
}
.voice-button,
.interrupt-button {
  display: flex;
  min-height: 76rpx;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  margin: 0;
  border-radius: 10rpx;
  font-size: 25rpx;
}
.voice-button {
  flex: 1;
  border: 0;
  background: #167d77;
  color: #fff;
}
.voice-button::after,
.interrupt-button::after {
  border: 0;
}
.voice-button[disabled] {
  opacity: 0.48;
}
.voice-button.recording {
  background: #bd4b42;
}
.interrupt-button {
  width: 140rpx;
  border: 1px solid #cfd7d8;
  background: #fff;
  color: #7b3b37;
}
.dialogue-row {
  display: flex;
  align-items: flex-start;
  gap: 14rpx;
  margin-top: 20rpx;
  padding-top: 18rpx;
  border-top: 1px solid #dbe9e7;
}
.dialogue-label {
  flex: 0 0 auto;
  color: #167d77;
  font-size: 22rpx;
  font-weight: 700;
}
.dialogue-label.assistant {
  color: #337fa0;
}
.dialogue-text {
  flex: 1;
  color: #20272d;
  font-size: 25rpx;
  line-height: 1.55;
}
.live-hint {
  display: block;
  margin-top: 20rpx;
  color: #59676b;
  font-size: 20rpx;
  line-height: 1.5;
}
.page-head,
.overview-row,
.model-top,
.section-title-row,
.service-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.page-head {
  margin-bottom: 28rpx;
}
.eyebrow {
  display: block;
  color: #167d77;
  font-size: 20rpx;
  font-weight: 700;
}
.page-title {
  display: block;
  margin-top: 8rpx;
  font-size: 40rpx;
  font-weight: 700;
}
.refresh {
  display: flex;
  width: 84rpx;
  height: 84rpx;
  align-items: center;
  justify-content: center;
  margin: 0;
  border: 1px solid #dce2e3;
  border-radius: 12rpx;
  background: #fff;
  color: #167d77;
}
.refresh::after {
  border: 0;
}
.notice {
  margin-bottom: 20rpx;
  padding: 18rpx;
  border-left: 6rpx solid #bd4b42;
  background: #fff0ee;
  color: #752d28;
  font-size: 24rpx;
}
.retry {
  margin-left: 18rpx;
  font-weight: 700;
  text-decoration: underline;
}
.overview,
.model-list,
.service-list,
.todo-list,
.completed-block {
  border: 1px solid #e0e5e6;
  border-radius: 10rpx;
  background: #fff;
}
.overview {
  padding: 28rpx;
}
.section-label,
.supporting,
.path,
.small-status,
.count,
.privacy-note {
  color: #59676b;
  font-size: 22rpx;
  line-height: 1.5;
}
.percent {
  display: block;
  margin-top: 6rpx;
  color: #167d77;
  font-size: 48rpx;
  font-weight: 700;
}
.track {
  height: 12rpx;
  overflow: hidden;
  margin-top: 22rpx;
  border-radius: 99rpx;
  background: #e7ecec;
}
.fill {
  height: 100%;
  border-radius: inherit;
  background: #16857d;
  transition: width 220ms ease;
}
.supporting {
  display: block;
  margin-top: 18rpx;
}
.section-title-row {
  margin: 38rpx 2rpx 14rpx;
}
.section-title {
  font-size: 28rpx;
  font-weight: 700;
}
.model-row {
  padding: 22rpx 24rpx;
  border-bottom: 1px solid #edf0f1;
}
.model-row:last-child {
  border-bottom: 0;
}
.model-name,
.service-name {
  font-size: 25rpx;
  font-weight: 600;
}
.model-state {
  font-size: 22rpx;
}
.ready {
  color: #15715e;
}
.missing {
  color: #9b5a17;
}
.model-track {
  height: 8rpx;
  margin-top: 14rpx;
}
.model-track .fill {
  background: #337fa0;
}
.path {
  display: block;
  margin-top: 10rpx;
  overflow-wrap: anywhere;
  font-size: 20rpx;
}
.service-heading {
  margin-top: 30rpx;
}
.service-row {
  justify-content: flex-start;
  min-height: 76rpx;
  padding: 0 22rpx;
  border-bottom: 1px solid #edf0f1;
}
.service-row:last-child {
  border-bottom: 0;
}
.service-dot {
  width: 16rpx;
  height: 16rpx;
  margin-right: 18rpx;
  border-radius: 50%;
}
.online {
  background: #17866e;
}
.offline {
  background: #9aa5a9;
}
.service-state {
  margin-left: auto;
  color: #59676b;
  font-size: 22rpx;
}
.todo-heading {
  margin-top: 38rpx;
}
.todo-row {
  display: flex;
  min-height: 88rpx;
  align-items: center;
  gap: 18rpx;
  padding: 16rpx 22rpx;
  border-bottom: 1px solid #edf0f1;
}
.todo-row:last-child {
  border-bottom: 0;
}
.checkbox {
  display: flex;
  flex: 0 0 38rpx;
  width: 38rpx;
  height: 38rpx;
  align-items: center;
  justify-content: center;
  border: 2rpx solid #9da9ab;
  border-radius: 8rpx;
}
.checkbox.checked {
  border-color: #16857d;
  background: #16857d;
  color: #fff;
}
.checkbox.disabled {
  opacity: 0.45;
}
.todo-text {
  flex: 1;
  font-size: 24rpx;
  line-height: 1.5;
}
.done .todo-text {
  color: #59676b;
  text-decoration: line-through;
}
.completed-block {
  margin-top: 18rpx;
  padding-top: 18rpx;
}
.completed-title {
  display: block;
  padding: 0 22rpx 8rpx;
  color: #15715e;
  font-size: 23rpx;
  font-weight: 700;
}
.empty {
  padding: 28rpx;
  border: 1px solid #d4e5e0;
  border-radius: 10rpx;
  background: #eff8f5;
  color: #176c58;
  font-size: 24rpx;
}
.privacy-note {
  display: block;
  margin: 28rpx 4rpx 0;
  font-size: 20rpx;
}
</style>
