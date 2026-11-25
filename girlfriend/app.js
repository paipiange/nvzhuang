import { CHARACTERS, parseCharacterIntent, restoreCharacter, updateCharacter } from '/character-state.mjs';
import { createDuplexSession, supportsDuplex } from '/duplex-session.mjs';

const CONFIG_STORAGE_KEY = 'mori-companion-model-v1';
const IMAGE_CONFIG_STORAGE_KEY = 'mori-companion-image-model-v1';
const CHARACTER_STORAGE_KEY = 'mori-companion-character-v1';
const VOICE_STORAGE_KEY = 'mori-companion-voice-v1';
const CHAT_STORAGE_KEY = 'mori-companion-chat-v1';
const CHAT_MODE_STORAGE_KEY = 'mori-companion-chat-mode-v1';
const LOCAL_BACKEND_STORAGE_KEY = 'mori-companion-local-backend-v1';
const SEED_CONFIG_STORAGE_KEY = 'mori-companion-seeduplex-v1';
const MAX_SAVED_MESSAGES = 80;
const MAX_CONTEXT_MESSAGES = 20;
const presets = {
  openai: { baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  deepseek: { baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  qwen: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  openrouter: { baseURL: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
};

const elements = {
  body: document.body,
  sidebar: document.querySelector('#sidebar'),
  mobileMenu: document.querySelector('#mobile-menu'),
  mobileScrim: document.querySelector('#mobile-scrim'),
  settingsDialog: document.querySelector('#settings-dialog'),
  settingsForm: document.querySelector('#settings-form'),
  baseURL: document.querySelector('#base-url'),
  model: document.querySelector('#model-name'),
  apiKey: document.querySelector('#api-key'),
  formError: document.querySelector('#form-error'),
  revealKey: document.querySelector('#reveal-key'),
  forgetKey: document.querySelector('#forget-key'),
  closeSettings: document.querySelector('#close-settings'),
  seedFields: document.querySelector('#seeduplex-fields'),
  seedAPIKey: document.querySelector('#seeduplex-api-key'),
  chatMode: document.querySelector('#chat-mode'),
  localBackendURL: document.querySelector('#local-backend-url'),
  checkVoiceHealth: document.querySelector('#check-voice-health'),
  voiceHealthStatus: document.querySelector('#voice-health-status'),
  localBackendFields: document.querySelector('#local-backend-fields'),
  remoteChatFields: document.querySelector('#remote-chat-fields'),
  localVoiceStatus: document.querySelector('#local-voice-status'),
  micButton: document.querySelector('#mic-button'),
  duplexButton: document.querySelector('#duplex-button'),
  duplexHint: document.querySelector('#duplex-hint'),
  duplexCaptions: document.querySelector('#duplex-captions'),
  interruptLocalVoice: document.querySelector('#interrupt-local-voice'),
  clearLocalMemory: document.querySelector('#clear-local-memory'),
  openSettings: document.querySelector('#open-settings'),
  openSettingsSide: document.querySelector('#open-settings-side'),
  connectionLabel: document.querySelector('#connection-label'),
  connectionDot: document.querySelector('#connection-dot'),
  sidebarConfigDot: document.querySelector('#sidebar-config-dot'),
  messages: document.querySelector('#messages'),
  conversationScroll: document.querySelector('#conversation-scroll'),
  welcome: document.querySelector('#welcome'),
  firstRunNote: document.querySelector('#first-run-note'),
  composerForm: document.querySelector('#composer-form'),
  messageInput: document.querySelector('#message-input'),
  sendButton: document.querySelector('#send-button'),
  sendLabel: document.querySelector('#send-label'),
  characterCount: document.querySelector('#character-count'),
  typing: document.querySelector('#typing-indicator'),
  newChat: document.querySelector('#new-chat'),
  exportChat: document.querySelector('#export-chat'),
  clearChat: document.querySelector('#clear-chat'),
  workspace: document.querySelector('.workspace'),
  pickerDialog: document.querySelector('#picker-dialog'),
  pickerTitle: document.querySelector('#picker-title'),
  pickerDescription: document.querySelector('#picker-description'),
  pickerGrid: document.querySelector('#picker-grid'),
  pickerSearch: document.querySelector('#picker-search'),
  pickerMore: document.querySelector('#picker-more'),
  pickerCount: document.querySelector('#picker-result-count'),
  pickerOutfitCount: document.querySelector('#outfit-result-count'),
  avatarFilters: document.querySelector('#avatar-filterbar'),
  outfitFilters: document.querySelector('#outfit-filterbar'),
  closePicker: document.querySelector('#close-picker'),
  closePickerDone: document.querySelector('#close-picker-done'),
  avatarImage: document.querySelector('#avatar-stage-image'),
  avatarStage: document.querySelector('#avatar-stage'),
  chooseAvatar: document.querySelector('#choose-avatar'),
  stageChangeAvatar: document.querySelector('#stage-change-avatar'),
  chooseOutfit: document.querySelector('#choose-outfit'),
  avatarCaption: document.querySelector('#avatar-caption'),
  outfitCaption: document.querySelector('#outfit-caption'),
  selectedOutfitPreview: document.querySelector('#selected-outfit-preview'),
  selectedOutfitImage: document.querySelector('#selected-outfit-image'),
  selectedOutfitLabel: document.querySelector('#selected-outfit-label'),
  poseSelect: document.querySelector('#pose-select'),
  characterSelect: document.querySelector('#character-select'),
  studioStatus: document.querySelector('#portrait-status'),
  profileName: document.querySelector('#studio-character-name'),
  profileBio: document.querySelector('.profile-bio'),
  stageName: document.querySelector('#stage-character-name'),
  pageName: document.querySelector('#page-character-name'),
  voiceToggle: document.querySelector('#voice-toggle'),
  mobileStudio: document.querySelector('#mobile-studio'),
  generateTryOn: document.querySelector('#generate-tryon'),
  imageProvider: document.querySelector('#image-provider'),
  imageBaseURL: document.querySelector('#image-base-url'),
  imageModel: document.querySelector('#image-model'),
  imageAPIKey: document.querySelector('#image-api-key'),
  reuseChatKey: document.querySelector('#reuse-chat-key'),
  forgetKey: document.querySelector('#forget-key'),
};

let config = getValidConfig(readStorage(CONFIG_STORAGE_KEY, null));
let imageConfig = getValidImageConfig(readStorage(IMAGE_CONFIG_STORAGE_KEY, null));
let seedConfig = null;
let legacySeedKeyRemoved = removeLegacySeedKey();
let chatMode = readStorage(CHAT_MODE_STORAGE_KEY, 'local');
if (!['local', 'remote', 'seeduplex'].includes(chatMode)) chatMode = 'local';
let localBackendBase = getValidLocalBackend(readStorage(LOCAL_BACKEND_STORAGE_KEY, '')) || 'http://127.0.0.1:8000';
let catalog = null;
let catalogLoad = null;
let pickerMode = 'avatar';
let avatarFilter = 'styling';
let outfitLibrary = 'real';
let pickerLimit = 35;
const savedCharacter = readStorage(CHARACTER_STORAGE_KEY, null);
let character = restoreCharacter(savedCharacter, [], []);
let voiceEnabled = readStorage(VOICE_STORAGE_KEY, true) !== false;
let history = loadHistory();
let voiceHealthController = null;
let voiceHealthGeneration = 0;
let portraitController = null;
let activeController = null;
let generatedObjectURL = null;
let localSocket = null;
let localConnectPromise = null;
let localReady = false;
let localWaiter = null;
let pendingVoiceMessage = null;
let localResetResolver = null;
let localAudioFrame = [];
let localAudioSegment = false;
let currentUtterance = null;
let localAudioQueue = [];
let localPlayingAudio = null;
let localAudioContext = null;
let localMediaStream = null;
let localMediaSource = null;
let localProcessor = null;
let localMute = null;
let localChunks = [];
let localSampleCount = 0;
let localRecording = false;
let localRecorderGeneration = 0;
let localTurnSequence = 0;
let localRecordingTimer = null;
let localSignalDetected = false;
const MAX_LOCAL_AUDIO_BYTES = 2 * 1024 * 1024;
const MAX_LOCAL_AUDIO_SECONDS = 64;
const MAX_LOCAL_REPLY_BYTES = 32 * 1024 * 1024;
let duplexSnapshot = { active: false, ready: false, state: 'idle' };
let duplexDraft = { turnId: '', user: '', reply: '', userSaved: false, replySaved: false };
const duplex = createDuplexSession({
  onState(snapshot) {
    duplexSnapshot = snapshot;
    updateDuplexUI();
    updateConnectionStatus();
    if (snapshot.message) setLocalVoiceStatus(snapshot.message);
    else if (snapshot.active) {
      const labels = { connecting: '正在连接豆包并准备麦克风…', listening: '通话中，持续聆听；可以直接说话。', speaking: '正在聆听你的话…', thinking: '豆包正在生成回复…', playing: '豆包正在说话，可以直接插话。' };
      setLocalVoiceStatus(snapshot.congested ? '网络拥塞，暂时丢弃采集帧，超过 3 秒将停止通话。' : labels[snapshot.state]);
    }
  },
  onLevel(rms) {
    elements.avatarStage.classList.toggle('is-speaking', rms > 0);
  },
  onEvent(event) {
    if (event.type === 'input.speech.started') {
      if (duplexDraft.turnId !== event.turn_id) duplexDraft = { turnId: event.turn_id, user: '', reply: '', userSaved: false, replySaved: false };
    }
    if (event.turn_id !== duplexDraft.turnId) return;
    if (event.type === 'asr.delta' || event.type === 'asr.final') duplexDraft.user = event.text;
    if (event.type === 'asr.final' && !duplexDraft.userSaved) {
      if (applyStudioIntent(event.text)) {
        duplex.interrupt();
        duplexDraft = { turnId: '', user: '', reply: '', userSaved: false, replySaved: false };
        renderDuplexCaptions();
        return;
      }
      duplexDraft.userSaved = true;
      history.push({ role: 'user', content: event.text, timestamp: Date.now() });
      persistHistory();
      renderMessages();
    }
    if (event.type === 'assistant.text.delta' || event.type === 'assistant.text.final') duplexDraft.reply = event.text;
    if (event.type === 'assistant.cancel') duplexDraft.reply = '';
    if (event.type === 'turn.end' && event.text?.trim() && !duplexDraft.replySaved) {
      duplexDraft.replySaved = true;
      history.push({ role: 'assistant', content: event.text.trim(), timestamp: Date.now() });
      persistHistory();
      renderMessages();
    }
    renderDuplexCaptions();
  },
});

function renderDuplexCaptions() {
  elements.duplexCaptions.hidden = !duplexDraft.user && !duplexDraft.reply;
  elements.duplexCaptions.textContent = [duplexDraft.user && `我：${duplexDraft.user}`, duplexDraft.reply && `${character.displayName}：${duplexDraft.reply}`].filter(Boolean).join('\n');
}

function updateDuplexUI() {
  const seed = chatMode === 'seeduplex';
  const supported = supportsDuplex();
  elements.duplexButton.hidden = !seed;
  elements.duplexButton.disabled = !duplexSnapshot.active && (!supported || Boolean(activeController) || localRecording || elements.micButton.disabled || elements.clearLocalMemory.disabled);
  elements.duplexButton.textContent = duplexSnapshot.active ? '结束通话' : '开始通话';
  elements.duplexButton.setAttribute('aria-label', duplexSnapshot.active ? '结束豆包持续通话并关闭麦克风' : '开始豆包持续通话');
  elements.duplexButton.setAttribute('aria-pressed', String(duplexSnapshot.active));
  elements.duplexButton.setAttribute('aria-busy', String(duplexSnapshot.state === 'connecting'));
  elements.duplexHint.hidden = !seed;
  elements.duplexHint.textContent = supported
    ? '持续开麦由豆包 VAD 自动分轮，可直接插话；检测到回声时建议佩戴耳机。“按轮语音”仍可使用。'
    : 'duplex_not_supported：当前设备不支持免提通话，请使用“按轮语音”手动结束每轮录音。';
  if (seed && !localRecording) elements.micButton.textContent = '按轮语音';
  elements.micButton.hidden = chatMode === 'remote' || duplexSnapshot.active;
  elements.interruptLocalVoice.textContent = duplexSnapshot.active ? '停止当前回复' : '打断';
  elements.clearLocalMemory.textContent = duplexSnapshot.active ? '结束并新建豆包会话' : seed ? '新建豆包语音会话' : '清空本机 Qwen 会话记忆';
}

function resetGeneratedPreview() {
  if (generatedObjectURL) URL.revokeObjectURL(generatedObjectURL);
  generatedObjectURL = null;

}

function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function saveStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    showSettingsError('无法保存到浏览器本机存储，请检查浏览器是否禁用了本地数据或空间已满。');
    return false;
  }
}

function removeLegacySeedKey() {
  try {
    localStorage.removeItem(SEED_CONFIG_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

function saveSettings(values) {
  const previous = [];
  try {
    for (const [key] of values) previous.push([key, localStorage.getItem(key)]);
    for (const [key, value] of values) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    }
    return true;
  } catch {
    let restored = true;
    for (const [key, value] of previous.reverse()) {
      try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch { restored = false; }
    }
    showSettingsError(restored ? '设置未保存，已保留原配置。请检查浏览器存储空间后重试。' : '设置保存失败且无法完全恢复，请检查浏览器存储并重新保存配置。');
    return false;
  }
}

function getValidConfig(value) {
  if (!value || typeof value !== 'object') return null;
  const baseURL = typeof value.baseURL === 'string' ? value.baseURL.trim() : '';
  const model = typeof value.model === 'string' ? value.model.trim() : '';
  const apiKey = typeof value.apiKey === 'string' ? value.apiKey.trim() : '';
  if (!baseURL || baseURL.length > 2048 || !model || !apiKey || apiKey.length > 2048 || model.length > 120) return null;
  try {
    const url = new URL(baseURL);
    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    const permitted = url.protocol === 'https:' || (url.protocol === 'http:' && localHosts.has(url.hostname));
    if (!permitted || url.username || url.password || url.search || url.hash) return null;
  } catch {
    return null;
  }
  return { baseURL, model, apiKey };
}

function getValidLocalBackend(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) return null;
    return url.href.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function setVoiceHealthStatus(message) {
  elements.voiceHealthStatus.textContent = message;
  elements.voiceHealthStatus.hidden = !message;
}

function cancelVoiceHealth(message = '') {
  voiceHealthGeneration++;
  voiceHealthController?.abort();
  voiceHealthController = null;
  elements.checkVoiceHealth.disabled = false;
  elements.checkVoiceHealth.setAttribute('aria-busy', 'false');
  setVoiceHealthStatus(message);
}

async function checkVoiceHealth() {
  if (voiceHealthController) return;
  const baseURL = getValidLocalBackend(elements.localBackendURL.value);
  if (!baseURL) { setVoiceHealthStatus('地址无效：仅允许无账号密码的 HTTP localhost、127.0.0.1 或 [::1]。'); return; }
  const mode = elements.chatMode.value;
  const generation = ++voiceHealthGeneration;
  const controller = new AbortController();
  voiceHealthController = controller;
  elements.checkVoiceHealth.disabled = true;
  elements.checkVoiceHealth.setAttribute('aria-busy', 'true');
  setVoiceHealthStatus('正在检查后端与语音服务，最多等待约 5 秒…');
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const address = new URL('/api/local-voice-health', window.location.href);
    address.searchParams.set('baseURL', baseURL);
    const response = await fetch(address.pathname + address.search, { method: 'GET', headers: { 'X-Companion-Request': 'voice-health', Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal });
    const result = await response.json();
    if (generation !== voiceHealthGeneration) return;
    if (!result || typeof result.backendAvailable !== 'boolean' || !['qwen', 'funasr', 'cosyvoice'].every(key => typeof result.models?.[key]?.available === 'boolean') || !(result.seedKeyConfigured === null || typeof result.seedKeyConfigured === 'boolean')) throw new Error('invalid health response');
    if (!response.ok || !result.backendAvailable) { setVoiceHealthStatus('后端未就绪或无法取得健康状态。请检查地址，并启动语音后端后重试。'); return; }
    const states = [['qwen', 'Qwen'], ['funasr', 'FunASR'], ['cosyvoice', 'CosyVoice']];
    const missing = states.filter(([key]) => !result.models[key].available).map(([, label]) => label);
    const local = missing.length ? `本机服务未就绪：${missing.join('、')}。请启动或等待模型加载。` : '本机 Qwen、FunASR、CosyVoice 均已就绪。';
    const seed = result.seedKeyConfigured === true
      ? '后端已配置豆包 Key；账号权限、音色与网络需开始通话后验证。'
      : result.seedKeyConfigured === false
        ? '后端未配置豆包 Key；使用豆包需在下方填写自己的有效 Key，或为后端配置账号。此次未读取或发送浏览器 Key。'
        : '无法确认后端豆包 Key 配置；可以检查后端版本，或在下方配置自己的账号 Key。';
    setVoiceHealthStatus(`后端可连接。${mode === 'seeduplex' ? `${seed} ${local} 豆包通话不依赖这三个本机模型。` : `${local} ${seed}`}`);
  } catch {
    if (generation === voiceHealthGeneration) setVoiceHealthStatus(controller.signal.aborted ? '检查超时，请确认后端已启动并检查地址后重试。' : '连接检查失败，请检查后端地址与本机服务；未发送 Key 或聊天。');
  } finally {
    clearTimeout(timeout);
    if (generation === voiceHealthGeneration) {
      voiceHealthController = null;
      elements.checkVoiceHealth.disabled = false;
      elements.checkVoiceHealth.setAttribute('aria-busy', 'false');
    }
  }
}

function getValidSeedConfig(value) {
  const apiKey = typeof value?.apiKey === 'string' ? value.apiKey.trim() : '';
  return apiKey && apiKey.length <= 2048 && /^[\x21-\x7e]+$/.test(apiKey) ? { apiKey } : null;
}

function updateChatModeUI() {
  const local = chatMode !== 'remote';
  const seed = chatMode === 'seeduplex';
  elements.chatMode.value = chatMode;
  elements.seedFields.hidden = !seed;
  elements.messageInput.placeholder = seed ? '点击“开始通话”持续说话，或选择“按轮语音”…' : '写下你此刻的心情…';
  elements.messageInput.disabled = seed || Boolean(activeController);
  elements.clearLocalMemory.textContent = seed ? '新建豆包语音会话' : '清空本机 Qwen 会话记忆';
  elements.localBackendFields.hidden = !local;
  elements.remoteChatFields.hidden = local;
  elements.micButton.hidden = !local;
  elements.clearLocalMemory.hidden = !local;
  elements.interruptLocalVoice.hidden = !local;
  elements.voiceToggle.disabled = !local && !speechSynthesisAvailable();
  elements.voiceToggle.textContent = elements.voiceToggle.disabled ? '语音不可用' : (voiceEnabled ? '自动朗读 · 开' : '自动朗读 · 关');
  elements.voiceToggle.setAttribute('aria-pressed', String(voiceEnabled && !elements.voiceToggle.disabled));
  if (local) {
    elements.apiKey.required = false;
    elements.baseURL.required = false;
    elements.model.required = false;
  } else {
    elements.apiKey.required = true;
    elements.baseURL.required = true;
    elements.model.required = true;
  }
  updateConnectionStatus();
  updateCharacterCount();
  updateDuplexUI();
}

function setLocalVoiceStatus(message) {
  elements.localVoiceStatus.textContent = message;
  elements.localVoiceStatus.hidden = !message;
}

function rejectLocalTurn(message, cancel = false) {
  const waiter = localWaiter;
  if (!waiter) return;
  localWaiter = null;
  clearTimeout(waiter.timeout);
  waiter.signal.removeEventListener('abort', waiter.onAbort);
  if (cancel && localSocket?.readyState === WebSocket.OPEN) {
    try { localSocket.send(JSON.stringify({ type: 'assistant.cancel' })); } catch { /* The close handler reports connection loss. */ }
  }
  stopLocalAudio();
  waiter.reject(new Error(message));
}

function ensureLocalSocket() {
  if (localReady && localSocket?.readyState === WebSocket.OPEN) return Promise.resolve();
  if (localConnectPromise) return localConnectPromise;
  const baseURL = getValidLocalBackend(localBackendBase);
  if (!baseURL) return Promise.reject(new Error('本机后端地址无效；仅允许 localhost、127.0.0.1 或 [::1]。'));
  const provider = chatMode === 'seeduplex' ? 'seeduplex' : 'local';
  const seedKey = provider === 'seeduplex' ? seedConfig?.apiKey : '';
  const profile = character;
  const address = new URL('/api/local-voice', window.location.href);
  address.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  address.searchParams.set('baseURL', baseURL);
  const connection = new Promise((resolve, reject) => {
    const socket = new WebSocket(address);
    localSocket = socket;
    socket.binaryType = 'arraybuffer';
    let settled = false;
    let socketError = '';
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.close();
        reject(new Error('语音连接超时，请检查后端地址、所选引擎配置与网络。'));
      }
    }, 15000);
    socket.onopen = () => socket.send(JSON.stringify({ type: 'session.start', provider, input_rate: 16000, codec: 'pcm_s16le', character_id: profile.characterId, persona_id: profile.personaId, voice_id: profile.voiceId, ...(seedKey ? { api_key: seedKey } : {}) }));
    socket.onmessage = (event) => {
      if (localSocket !== socket) return;
      if (event.data instanceof ArrayBuffer) {
        if (!localWaiter) return;
        if (!localAudioSegment) { rejectLocalTurn('本机音频分段格式无效，请重试。', true); return; }
        localWaiter.audioBytes += event.data.byteLength;
        if (localWaiter.audioBytes > MAX_LOCAL_REPLY_BYTES) {
          rejectLocalTurn('语音回复超过 32 MiB 限制，已取消本轮。', true);
          return;
        }
        localAudioFrame.push(event.data);
        return;
      }
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) return;
      if (message.type === 'session.ready') {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          localConnectPromise = null;
          if (profile.characterId !== 'zhixia' && (message.character_id !== profile.characterId || message.persona_id !== profile.personaId || message.voice_id !== profile.voiceId)) {
            socket.close();
            reject(new Error('语音后端未确认当前角色与音色，请更新后端或切回知夏。'));
            return;
          }
          localReady = true;
          updateConnectionStatus();
          setLocalVoiceStatus(provider === 'seeduplex' ? '豆包语音会话已就绪。录音会发送给豆包语音服务并产生其用量。' : '本机语音后端已连接；模型服务状态会在发言时验证。会话记忆只在此连接中保留。');
          resolve();
        }
        return;
      }
      if (message.type === 'session.reset') {
        localResetResolver?.();
        localResetResolver = null;
        setLocalVoiceStatus('当前本机 Qwen 会话记忆已清空。');
        return;
      }
      if (localWaiter && message.turn_id && message.turn_id !== localWaiter.turnId) return;
      if (message.type === 'asr.final' && localWaiter && (typeof message.text !== 'string' || !message.text.trim() || [...message.text].length > 2000)) {
        rejectLocalTurn('本机识别结果无效，请重新录音。', true);
        return;
      }
      if (message.type === 'asr.final' && localWaiter && typeof message.text === 'string' && message.text.trim()) {
        if (applyStudioIntent(message.text)) {
          if (localSocket === socket) stopGenerating();
          return;
        }
        if (pendingVoiceMessage) {
          history.push({ role: 'user', content: message.text.trim(), timestamp: pendingVoiceMessage.timestamp });
          pendingVoiceMessage = null;
        } else {
          const userMessage = history.at(-1);
          if (userMessage?.role === 'user') userMessage.content = message.text.trim();
        }
        persistHistory();
        renderMessages();
      }
      if (message.type === 'assistant.cancel') {
        rejectLocalTurn('本机服务已取消本轮回复，请重试。');
        return;
      }
      if (message.type === 'assistant.text.delta' && localWaiter) {
        if (typeof message.text !== 'string' || localWaiter.reply.length + message.text.length > 20000) {
          rejectLocalTurn('本机文字回复格式无效或超过长度限制。', true);
          return;
        }
        localWaiter.reply += message.text;
      }
      if (message.type === 'assistant.audio.start' && localWaiter) {
        if (localAudioSegment) { rejectLocalTurn('本机音频分段重叠，请重试。', true); return; }
        localAudioSegment = true;
        localAudioFrame = [];
      }
      if (message.type === 'assistant.audio.end' && localWaiter) {
        if (!localAudioSegment || !localAudioFrame.length) { rejectLocalTurn('本机音频分段不完整，请重试。', true); return; }
        localAudioSegment = false;
        if (voiceEnabled && !currentUtterance) {
          const blob = new Blob(localAudioFrame, { type: 'audio/wav' });
          localAudioQueue.push(URL.createObjectURL(blob));
          playLocalAudio();
        }
        localAudioFrame = [];
      }
      if (message.type === 'error') {
        const error = new Error(message.message || '语音服务处理失败，请检查所选引擎状态后重试。');
        socketError = error.message;
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          localConnectPromise = null;
          socket.close();
          reject(error);
        }
        if (localWaiter) {
          const waiter = localWaiter;
          localWaiter = null;
          clearTimeout(waiter.timeout);
          waiter.signal.removeEventListener('abort', waiter.onAbort);
          stopLocalAudio();
          waiter.reject(error);
        } else setLocalVoiceStatus(error.message);
      }
      if (message.type === 'turn.end' && localWaiter) {
        if (localAudioSegment) { rejectLocalTurn('本机音频未完整传输，请重试。', true); return; }
        const waiter = localWaiter;
        localWaiter = null;
        clearTimeout(waiter.timeout);
        waiter.signal.removeEventListener('abort', waiter.onAbort);
        if (!waiter.reply.trim()) waiter.reject(new Error('语音模型没有返回文字回复，请检查所选服务后重试。'));
        else {
          history.push({ role: 'assistant', content: waiter.reply.trim(), timestamp: Date.now() });
          persistHistory();
          waiter.resolve(waiter.reply.trim());
        }
      }
    };
    socket.onclose = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error('语音连接已断开，请检查后端、引擎配置与网络。'));
      }
      if (localSocket !== socket) return;
      localReady = false;
      localConnectPromise = null;
      localSocket = null;
      localResetResolver?.(new Error('语音连接断开，记忆已随连接释放。'));
      localResetResolver = null;
      discardLocalRecording();
      stopLocalAudio();
      setLocalVoiceStatus(socketError || '语音连接已断开，录音与播放已停止；下一轮将重新连接。');
      updateConnectionStatus();
      if (localWaiter) {
        const waiter = localWaiter;
        localWaiter = null;
        clearTimeout(waiter.timeout);
        waiter.signal.removeEventListener('abort', waiter.onAbort);
        waiter.reject(new Error('语音连接断开，本轮未完成；请重连后重试。'));
      }
    };
    socket.onerror = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        socket.close();
        reject(new Error('无法连接本机语音服务；请检查 GoFrame 地址与 MuMu 端口转发。'));
      }
    };
  });
  localConnectPromise = connection;
  return connection;
}

function playLocalAudio() {
  if (localPlayingAudio || !localAudioQueue.length) return;
  const url = localAudioQueue.shift();
  const audio = new Audio(url);
  localPlayingAudio = audio;
  const finish = () => {
    if (localPlayingAudio !== audio) return;
    URL.revokeObjectURL(url);
    localPlayingAudio = null;
    playLocalAudio();
  };
  audio.onended = finish;
  audio.onerror = () => {
    if (localPlayingAudio !== audio) return;
    setLocalVoiceStatus('文字回复已生成，但本机音频无法播放；可点击回复下方“朗读”重试。');
    finish();
  };
  void audio.play().catch(() => {
    if (localPlayingAudio !== audio) return;
    setLocalVoiceStatus('本机浏览器阻止了自动播放；可点击回复下方“朗读”收听。');
    finish();
  });
}

function stopLocalAudio(clearFrames = true) {
  currentUtterance = null;
  if (speechSynthesisAvailable()) window.speechSynthesis.cancel();
  elements.avatarStage.classList.remove('is-speaking');
  if (localPlayingAudio) {
    localPlayingAudio.pause();
    URL.revokeObjectURL(localPlayingAudio.src);
    localPlayingAudio.onended = null;
    localPlayingAudio.onerror = null;
    localPlayingAudio = null;
  }
  localAudioQueue.forEach(URL.revokeObjectURL);
  localAudioQueue = [];
  if (clearFrames) {
    localAudioFrame = [];
    localAudioSegment = false;
  }
}

function requestLocalTurn(signal, send, turnId) {
  return ensureLocalSocket().then(() => new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('已取消', 'AbortError'));
    const waiter = { resolve, reject, turnId, reply: '', audioBytes: 0, signal, timeout: null, onAbort: null };
    waiter.timeout = setTimeout(() => {
      if (localWaiter === waiter) {
        localWaiter = null;
        signal.removeEventListener('abort', waiter.onAbort);
        disconnectLocalVoice(false);
        reject(new Error('语音处理超时，请检查所选引擎服务后重试。'));
      }
    }, 120000);
    waiter.onAbort = () => {
      if (localWaiter === waiter) localWaiter = null;
      clearTimeout(waiter.timeout);
      if (localSocket?.readyState === WebSocket.OPEN) localSocket.send(JSON.stringify({ type: 'assistant.cancel' }));
      stopLocalAudio();
      reject(new DOMException('已取消', 'AbortError'));
    };
    localWaiter = waiter;
    signal.addEventListener('abort', waiter.onAbort, { once: true });
    try { send(localSocket); } catch (error) {
      localWaiter = null;
      clearTimeout(waiter.timeout);
      signal.removeEventListener('abort', waiter.onAbort);
      reject(error);
    }
  }));
}

function pcm16k(chunks, sampleCount, sourceRate) {
  const input = new Float32Array(sampleCount);
  let offset = 0;
  for (const chunk of chunks) { input.set(chunk, offset); offset += chunk.length; }
  const count = Math.floor(sampleCount * 16000 / sourceRate);
  if (!Number.isFinite(count) || count < 1600 || count * 2 > MAX_LOCAL_AUDIO_BYTES) throw new Error('录音无效，请录制 0.1 至 64 秒 / 2 MiB 的语音。');
  const output = new ArrayBuffer(count * 2);
  const view = new DataView(output);
  let peak = 0;
  let squared = 0;
  for (let i = 0; i < count; i++) {
    const position = i * sourceRate / 16000;
    const left = Math.floor(position);
    const fraction = position - left;
    const value = Math.max(-1, Math.min(1, (input[left] || 0) + ((input[Math.min(left + 1, sampleCount - 1)] || 0) - (input[left] || 0)) * fraction));
    squared += value * value;
    peak = Math.max(peak, Math.abs(value));
    view.setInt16(i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  localSignalDetected = Math.sqrt(squared / count) >= 0.00005 || peak >= 0.0005;
  if (!localSignalDetected) throw new Error('录音近乎静音，本轮未发送；请检查 MuMu 宿主机麦克风与输入设备。');
  return output;
}

function releaseLocalRecorder() {
  if (localRecordingTimer) clearTimeout(localRecordingTimer);
  localRecordingTimer = null;
  if (localProcessor) { localProcessor.onaudioprocess = null; localProcessor.disconnect(); localProcessor = null; }
  localMediaSource?.disconnect(); localMediaSource = null;
  localMute?.disconnect(); localMute = null;
  localMediaStream?.getTracks().forEach((track) => track.stop()); localMediaStream = null;
  if (localAudioContext && localAudioContext.state !== 'closed') void localAudioContext.close();
  localAudioContext = null;
}

async function startLocalRecording(generation) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前 WebView 不支持麦克风；请检查 MuMu 权限或改用系统浏览器。');
  await ensureLocalSocket();
  if (generation !== localRecorderGeneration) return;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  if (generation !== localRecorderGeneration) { stream.getTracks().forEach((track) => track.stop()); return; }
  localMediaStream = stream;
  localChunks = [];
  localSampleCount = 0;
  const context = new AudioContext();
  localAudioContext = context;
  await context.resume();
  if (generation !== localRecorderGeneration) return;
  localMediaSource = context.createMediaStreamSource(stream);
  localProcessor = context.createScriptProcessor(4096, 1, 1);
  localMute = context.createGain();
  localMute.gain.value = 0;
  localProcessor.onaudioprocess = (event) => {
    if (!localRecording) return;
    const chunk = event.inputBuffer.getChannelData(0).slice();
    localChunks.push(chunk);
    localSampleCount += chunk.length;
    if (localSampleCount >= context.sampleRate * MAX_LOCAL_AUDIO_SECONDS) stopLocalRecording();
  };
  localMediaSource.connect(localProcessor);
  localProcessor.connect(localMute);
  localMute.connect(context.destination);
  localRecording = true;
  updateDuplexUI();
  elements.micButton.textContent = '结束录音';
  elements.micButton.setAttribute('aria-label', '结束语音输入');
  setLocalVoiceStatus('正在录音；请说完后点击“结束录音”。');
  localRecordingTimer = setTimeout(stopLocalRecording, MAX_LOCAL_AUDIO_SECONDS * 1000);
}

function stopLocalRecording() {
  if (!localRecording) return;
  localRecording = false;
  updateDuplexUI();
  const chunks = localChunks;
  const count = localSampleCount;
  const rate = localAudioContext?.sampleRate || 0;
  releaseLocalRecorder();
  localChunks = [];
  localSampleCount = 0;
  elements.micButton.textContent = '语音';
  elements.micButton.setAttribute('aria-label', '开始语音输入');
  elements.messageInput.disabled = chatMode === 'seeduplex';
  transientError = null;
  try {
    const pcm = pcm16k(chunks, count, rate);
    const turnId = `web-${Date.now()}-${++localTurnSequence}`;
    pendingVoiceMessage = { role: 'user', content: '正在识别语音…', timestamp: Date.now(), pending: true };
    renderMessages();
    const controller = new AbortController();
    activeController = controller;
    setBusy(true);
    setLocalVoiceStatus(chatMode === 'seeduplex' ? '录音正在按节奏发送给豆包，等待识别与回复…' : '语音已发送至本机 FunASR，等待识别与回复…');
    void requestLocalTurn(controller.signal, (socket) => {
      socket.send(pcm);
      socket.send(JSON.stringify({ type: 'input.end', turn_id: turnId }));
    }, turnId).catch((error) => {
      if (activeController === controller && error.name !== 'AbortError') transientError = {
        role: 'assistant', content: `${error.message}${pendingVoiceMessage ? ' 请重新录音后发送。' : ''}`,
        timestamp: Date.now(), error: true, retryable: !pendingVoiceMessage,
      };
    }).finally(() => {
      if (activeController === controller) {
        pendingVoiceMessage = null;
        activeController = null;
        setBusy(false);
        renderMessages();
      }
    });
  } catch (error) {
    setLocalVoiceStatus(error.message || '录音数据无效。');
  }
}

function updateConnectionStatus() {
  const voice = chatMode !== 'remote';
  const ready = voice ? localReady || duplexSnapshot.ready : Boolean(getValidConfig(config));
  const label = chatMode === 'seeduplex' ? '豆包语音' : '本机后端';
  elements.connectionLabel.textContent = voice ? (ready ? `${label}已连接` : `${label}未连接`) : (ready ? '模型已就绪' : '等待连接');
  elements.connectionDot.classList.toggle('ready', ready);
  elements.sidebarConfigDot.classList.toggle('ready', ready);
  elements.firstRunNote.hidden = voice || ready;
  return ready;
}

function showSettingsError(message = '') {
  elements.formError.textContent = message;
  elements.formError.hidden = !message;
  if (message && !elements.settingsDialog.open) setLocalVoiceStatus(message);
}

function getValidImageConfig(value) {
  if (!value || typeof value !== 'object') return null;
  const provider = typeof value.provider === 'string' ? value.provider.trim().toLowerCase() : '';
  const baseURL = typeof value.baseURL === 'string' ? value.baseURL.trim() : '';
  const model = typeof value.model === 'string' ? value.model.trim() : '';
  const apiKey = typeof value.apiKey === 'string' ? value.apiKey.trim() : '';
  if (!['gemini', 'openai'].includes(provider) || !baseURL || baseURL.length > 2048 || !model || model.length > 120 || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(model) || !apiKey || apiKey.length > 2048) return null;
  try {
    const url = new URL(baseURL);
    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && localHosts.has(url.hostname))) || url.username || url.password || url.search || url.hash) return null;
  } catch {
    return null;
  }
  return { provider, baseURL, model, apiKey };
}

function renderCharacter() {
  elements.characterSelect.value = character.characterId;
  elements.profileName.textContent = character.displayName;
  elements.profileBio.textContent = character.characterId === 'linxi' ? '明快、坦率，喜欢给小日子找一点新鲜感。' : '温柔、好奇，也喜欢听你认真讲那些小小的日常。';
  elements.stageName.textContent = `${character.displayName} · 在线`;
  elements.pageName.textContent = `和${character.displayName}在一起`;
  const selectedPortrait = catalog?.portraits.find((item) => item.id === character.faceId);
  if (selectedPortrait) elements.avatarCaption.textContent = `${selectedPortrait.label} · ${selectedPortrait.hair || selectedPortrait.style || '造型'}`;
  const selectedOutfit = catalog?.outfits.find((item) => item.id === character.outfitId && item.library === character.outfitLibrary);
  if (selectedOutfit) {
    elements.outfitCaption.textContent = `${selectedOutfit.category} · ${selectedOutfit.id}`;
    elements.selectedOutfitLabel.textContent = `${selectedOutfit.category} · ${selectedOutfit.id}`;
    elements.selectedOutfitImage.src = selectedOutfit.image;
    elements.selectedOutfitImage.hidden = false;
    elements.selectedOutfitPreview.hidden = false;
  }
  const poseOption = [...elements.poseSelect.options].find((option) => option.value === character.poseId);
  if (poseOption) elements.poseSelect.value = character.poseId;
  elements.avatarStage.dataset.pose = character.poseId;
  if (generatedObjectURL) {
    elements.avatarImage.src = generatedObjectURL;
    elements.avatarImage.alt = `${character.displayName}已生成的${selectedOutfit?.category || ''}穿搭形象`;
    elements.avatarStage.classList.add('is-generated');
  } else {
    elements.avatarImage.src = selectedPortrait?.image || '/assets/portrait/thumbs/f000a1c4200.webp';
    elements.avatarImage.alt = `${character.displayName}当前选择的 AI 模特形象`;
    elements.avatarStage.classList.remove('is-generated');
  }
}

function historyKey() {
  return character.characterId === 'zhixia' ? CHAT_STORAGE_KEY : `${CHAT_STORAGE_KEY}:${character.characterId}`;
}

function loadHistory() {
  const saved = readStorage(historyKey(), []);
  return Array.isArray(saved) ? saved.filter((item) => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string' && item.content.trim()).slice(-MAX_SAVED_MESSAGES)
    .map(({ role, content, timestamp }) => ({ role, content, timestamp: Number.isFinite(timestamp) ? timestamp : undefined })) : [];
}

function setPortraitStatus(message) {
  elements.studioStatus.textContent = message;
  elements.studioStatus.hidden = !message;
}

function finishPortrait() {
  elements.generateTryOn.textContent = '生成这套穿搭';
  elements.avatarStage.classList.remove('is-generating');
}

function cancelPortrait(message = '') {
  if (!portraitController) return;
  const controller = portraitController;
  portraitController = null;
  controller.abort();
  finishPortrait();
  setPortraitStatus(message);
}

function changeCharacterAppearance(action) {
  const next = catalog && updateCharacter(character, action, catalog.portraits, catalog.outfits);
  if (!next) {
    setPortraitStatus('该角色或造型不在本地清单中（avatar_asset_missing）。');
    renderCharacter();
    return false;
  }
  if (next === character) return true;
  const switched = next.characterId !== character.characterId;
  if (!saveStorage(CHARACTER_STORAGE_KEY, next)) { renderCharacter(); return false; }
  if (switched) disconnectLocalVoice();
  cancelPortrait();
  resetGeneratedPreview();
  character = next;
  setPortraitStatus('');
  renderCharacter();
  if (switched) {
    transientError = null;
    history = loadHistory();
    renderMessages();
    setLocalVoiceStatus(`已切换到${character.displayName}；下一轮建立独立语音会话。`);
  }
  return true;
}

function applyStudioIntent(text) {
  if (!catalog) return false;
  const action = parseCharacterIntent(text, character.outfitLibrary, catalog.outfits);
  return action ? (changeCharacterAppearance(action), true) : false;
}
function speechSynthesisAvailable() { return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window; }

function speak(text, force = false) {
  if ((!voiceEnabled && !force) || !speechSynthesisAvailable() || !text) return;
  if (duplex.active || localRecording || elements.micButton.disabled) {
    setLocalVoiceStatus('正在准备或进行录音，请结束通话或录音后再朗读。');
    return;
  }
  stopLocalAudio(false);
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 1200));
  utterance.lang = 'zh-CN';
  utterance.rate = character.characterId === 'linxi' ? 1.03 : 0.97;
  utterance.pitch = character.characterId === 'linxi' ? 0.98 : 1.06;
  const voices = window.speechSynthesis.getVoices();
  const chineseVoice = voices.find((voice) => voice.lang.toLowerCase().startsWith('zh') && /female|xiaoxiao|xiaoyi|婷|晓|女/i.test(voice.name)) ||
    voices.find((voice) => voice.lang.toLowerCase().startsWith('zh'));
  if (chineseVoice) utterance.voice = chineseVoice;
  currentUtterance = utterance;
  utterance.onstart = () => { if (currentUtterance === utterance) elements.avatarStage.classList.add('is-speaking'); };
  const finish = () => {
    if (currentUtterance !== utterance) return;
    currentUtterance = null;
    elements.avatarStage.classList.remove('is-speaking');
  };
  utterance.onend = finish;
  utterance.onerror = finish;
  try { window.speechSynthesis.speak(utterance); }
  catch { finish(); setLocalVoiceStatus('浏览器暂时无法朗读，请检查设备音色后重试。'); }
}

async function loadCatalog() {
  if (catalog) return catalog;
  if (!catalogLoad) catalogLoad = (async () => {
    const response = await fetch('/api/catalog', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('本地模特和服装图集暂时无法加载。');
    const data = await response.json();
    if (!data || !Array.isArray(data.portraits) || !Array.isArray(data.outfits)) throw new Error('本地模特图集格式无效。');
    const counts = { real: 0, anime: 0 };
    data.outfits = data.outfits.filter(item => item?.library === 'real' || item?.library === 'anime').map(item => ({ ...item, number: ++counts[item.library] }));
    catalog = data;
    character = restoreCharacter(savedCharacter, data.portraits, data.outfits);
    if (savedCharacter !== null) saveStorage(CHARACTER_STORAGE_KEY, character);
    renderCharacter();
    return catalog;
  })().finally(() => { catalogLoad = null; });
  return catalogLoad;
}

async function openPicker(mode) {
  pickerMode = mode;
  pickerLimit = 35;
  elements.pickerSearch.value = '';
  elements.pickerTitle.textContent = mode === 'avatar' ? '挑一张喜欢的头像' : `给${character.displayName}挑一套穿搭`;
  elements.pickerDescription.textContent = mode === 'avatar'
    ? '从项目内置 AI 模特库里挑选角色面容和造型。'
    : '选择衣服后可以预览；点击“生成这套穿搭”让图像模型创建完整新形象。';
  elements.avatarFilters.hidden = mode !== 'avatar';
  elements.outfitFilters.hidden = mode !== 'outfit';
  document.querySelector('.picker-search-label').textContent = mode === 'avatar' ? '搜索发型或模特编号' : '搜索穿搭、服装品类或编号';
  elements.pickerSearch.placeholder = mode === 'avatar' ? '输入发型关键词或造型编号…' : '搜索春夏秋冬、蕾丝、SPR-0001…';
  if (mode === 'avatar') {
    document.querySelectorAll('[data-avatar-filter]').forEach((button) => button.classList.toggle('selected', button.dataset.avatarFilter === avatarFilter));
  } else {
    document.querySelectorAll('[data-outfit-library]').forEach((button) => button.classList.toggle('selected', button.dataset.outfitLibrary === outfitLibrary));
  }
  elements.pickerGrid.replaceChildren(Object.assign(document.createElement('p'), { className: 'picker-empty', textContent: '正在打开本地图库…' }));
  if (!elements.pickerDialog.open) elements.pickerDialog.showModal();
  try {
    await loadCatalog();
    renderPicker();
  } catch (error) {
    elements.pickerGrid.replaceChildren(Object.assign(document.createElement('p'), { className: 'picker-empty', textContent: error.message }));
  }
}

function filteredPickerItems() {
  const query = elements.pickerSearch.value.trim().toLocaleLowerCase('zh-CN');
  if (pickerMode === 'avatar') {
    return catalog.portraits.filter((item) => item.section === avatarFilter &&
      (!query || `${item.id} ${item.label} ${item.hair} ${item.style} ${item.keywords}`.toLocaleLowerCase('zh-CN').includes(query)));
  }
  return catalog.outfits.filter((item) => item.library === outfitLibrary &&
    (!query || `${item.id} ${item.category} ${item.keywords}`.toLocaleLowerCase('zh-CN').includes(query)));
}

function renderPicker() {
  if (!catalog) return;
  const items = filteredPickerItems();
  const shown = items.slice(0, pickerLimit);
  const selectedId = pickerMode === 'avatar' ? character.faceId : outfitLibrary === character.outfitLibrary ? character.outfitId : null;
  const fragment = document.createDocumentFragment();
  if (!shown.length) {
    const empty = document.createElement('p');
    empty.className = 'picker-empty';
    empty.textContent = '没有找到匹配的本地造型，试试其他关键词吧。';
    fragment.append(empty);
  }
  for (const item of shown) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `picker-item${item.id === selectedId ? ' selected' : ''}`;
    button.setAttribute('aria-label', pickerMode === 'avatar' ? `选择 ${item.label} ${item.id}` : `选择${item.library === 'anime' ? '动漫' : '真人'}穿搭 ${item.id}`);
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = item.image;
    img.alt = '';
    const copy = document.createElement('span');
    copy.className = 'picker-item-copy';
    const title = document.createElement('strong');
    title.textContent = pickerMode === 'avatar' ? (item.style || item.hair || item.label) : `${item.number} 号 · ${item.category} · ${item.id}`;
    const sub = document.createElement('small');
    sub.textContent = pickerMode === 'avatar' ? item.label : item.library === 'anime' ? '二次元造型' : '真人服装';
    copy.append(title, sub);
    button.append(img, copy);
    button.addEventListener('click', () => {
      const action = pickerMode === 'avatar' ? { kind: 'face', id: item.id } : { kind: 'outfit', id: item.id, library: item.library };
      if (changeCharacterAppearance(action)) elements.pickerDialog.close();
    });
    fragment.append(button);
  }
  elements.pickerGrid.replaceChildren(fragment);
  if (pickerMode === 'avatar') elements.pickerCount.textContent = `${items.length.toLocaleString()} 位`;
  else elements.pickerOutfitCount.textContent = `${items.length.toLocaleString()} 套`;
  elements.pickerMore.hidden = items.length <= pickerLimit;
}

function getImageConfigFromForm() {
  const provider = elements.imageProvider.value;
  const defaults = provider === 'gemini'
    ? { baseURL: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.1-flash-image' }
    : { baseURL: 'https://api.openai.com/v1', model: 'gpt-image-2' };
  return getValidImageConfig({
    provider,
    baseURL: elements.imageBaseURL.value.trim() || defaults.baseURL,
    model: elements.imageModel.value.trim() || defaults.model,
    apiKey: elements.imageAPIKey.value.trim(),
  });
}

function openSettings() {
  const current = getValidConfig(config);
  const image = getValidImageConfig(imageConfig);
  elements.baseURL.value = current?.baseURL ?? '';
  elements.model.value = current?.model ?? '';
  elements.apiKey.value = current?.apiKey ?? '';
  elements.apiKey.type = 'password';
  elements.revealKey.textContent = '显示';
  const provider = image?.provider ?? 'gemini';
  elements.imageProvider.value = provider;
  elements.imageBaseURL.value = image?.baseURL ?? (provider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta' : 'https://api.openai.com/v1');
  elements.imageModel.value = image?.model ?? (provider === 'gemini' ? 'gemini-3.1-flash-image' : 'gpt-image-2');
  elements.imageAPIKey.value = image?.apiKey ?? '';
  elements.seedAPIKey.value = seedConfig?.apiKey ?? '';
  elements.localBackendURL.value = localBackendBase;
  updateChatModeUI();
  showSettingsError(legacySeedKeyRemoved ? '' : '检测到旧版浏览器语音 Key，但无法自动清除；请在浏览器设置中清除此页面数据。');
  if (!elements.settingsDialog.open) elements.settingsDialog.showModal();
}

const mobileNavigation = window.matchMedia?.('(max-width: 790px)');
function syncSidebarFocus() {
  elements.sidebar.inert = Boolean(mobileNavigation?.matches && !elements.sidebar.classList.contains('open'));
}
mobileNavigation?.addEventListener('change', () => { closeSidebar(); syncSidebarFocus(); });
function closeSidebar() {
  elements.sidebar.classList.remove('open');
  elements.mobileMenu.setAttribute('aria-expanded', 'false');
  elements.mobileScrim.hidden = true;
  syncSidebarFocus();
}

function scrollToLatest() {
  requestAnimationFrame(() => {
    elements.conversationScroll.scrollTop = elements.conversationScroll.scrollHeight;
  });
}

function formatTime(date = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function makeMessageRow(message, index) {
  const isUser = message.role === 'user';
  const row = document.createElement('article');
  row.className = `message-row${isUser ? ' user' : ''}${message.error ? ' error' : ''}`;
  const avatar = document.createElement('span');
  avatar.className = 'message-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = isUser ? '你' : '知';

  const stack = document.createElement('div');
  stack.className = 'message-stack';
  const name = document.createElement('span');
  name.className = 'message-name';
  name.textContent = isUser ? '你' : character.displayName;
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = message.content;
  const time = document.createElement('time');
  time.className = 'message-time';
  const date = new Date(Number.isFinite(message.timestamp) ? message.timestamp : NaN);
  const validTime = Number.isFinite(message.timestamp) && Number.isFinite(date.getTime());
  if (validTime) time.dateTime = date.toISOString();
  time.textContent = validTime ? formatTime(date) : '';
  stack.append(name, bubble, time);

  if ((message.error && message.retryable !== false) || (isUser && !message.pending && index === history.length - 1 && !activeController)) {
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'message-action';
    retry.textContent = message.error ? '↻ 重试' : '↻ 补发';
    retry.addEventListener('click', () => retryLastMessage());
    actions.append(retry);
    stack.append(actions);
  } else if (!isUser && !message.error) {
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'message-action';
    play.textContent = '♫ 朗读';
    play.setAttribute('aria-label', `用本机语音朗读${character.displayName}的回复`);
    play.addEventListener('click', () => speak(message.content, true));
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'message-action';
    copy.textContent = '复制';
    copy.setAttribute('aria-label', `复制${character.displayName}的回复`);
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(message.content);
        copy.textContent = '已复制';
        setTimeout(() => { copy.textContent = '复制'; }, 1400);
      } catch {
        copy.textContent = '复制失败';
        setTimeout(() => { copy.textContent = '复制'; }, 1600);
      }
    });
    actions.append(play, copy);
    stack.append(actions);
  }

  row.append(avatar, stack);
  return row;
}

let transientError = null;
function renderMessages() {
  const visible = [...history, ...(pendingVoiceMessage ? [pendingVoiceMessage] : []), ...(transientError ? [transientError] : [])];
  elements.messages.replaceChildren(...visible.map((message, index) => makeMessageRow(message, index)));
  const hasChat = history.length > 0;
  elements.welcome.hidden = visible.length > 0;
  elements.exportChat.disabled = !hasChat;
  scrollToLatest();
}

function persistHistory() {
  history = history.slice(-MAX_SAVED_MESSAGES);
  saveStorage(historyKey(), history);
}

function exportHistory() {
  if (!history.length) return;
  const dateFormatter = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
  const lines = [`${character.displayName} · AI 虚拟陪伴聊天记录`, ''];
  for (const message of history) {
    const date = new Date(Number.isFinite(message.timestamp) ? message.timestamp : NaN);
    const time = Number.isFinite(message.timestamp) && !Number.isNaN(date.getTime()) ? dateFormatter.format(date) : '';
    lines.push(`${time ? `[${time}] ` : ''}${message.role === 'user' ? '你' : character.displayName}`, message.content, '');
  }
  const url = URL.createObjectURL(new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  const now = new Date();
  const localDate = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  link.download = `${character.characterId}-chat-${localDate}.txt`;
  try { link.click(); }
  catch { setLocalVoiceStatus('浏览器未能导出记录，请检查下载权限后重试。'); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

function setBusy(busy) {
  elements.typing.hidden = !busy;
  elements.messageInput.disabled = busy || chatMode === 'seeduplex';
  elements.sendButton.disabled = busy;
  elements.sendButton.classList.toggle('is-stop', busy);
  elements.sendLabel.textContent = busy ? '停止' : '发送';
  elements.sendButton.disabled = !busy && chatMode === 'seeduplex';
  elements.sendButton.setAttribute('aria-label', busy ? '停止生成' : '发送消息');
  elements.sendButton.title = busy ? '停止生成' : '发送消息';
  updateDuplexUI();
  scrollToLatest();
}

function stopGenerating() {
  const controller = activeController;
  if (!controller) return;
  activeController = null;
  controller.abort();
  pendingVoiceMessage = null;
  setBusy(false);
  renderMessages();
}

async function sendMessage(text = elements.messageInput.value.trim(), retryExisting = false) {
  if (chatMode === 'seeduplex') {
    setLocalVoiceStatus('当前是豆包语音模式，请点击“开始通话”或“按轮语音”；文字聊天请在设置中切换到本机或云端文字模式。');
    return;
  }
  const content = text.trim();
  if (!content || activeController || localRecording || elements.micButton.disabled || elements.clearLocalMemory.disabled) return;
  if (!retryExisting && applyStudioIntent(content)) {
    elements.messageInput.value = '';
    updateCharacterCount();
    return;
  }
  if (chatMode === 'local' && [...content].length > 2000) {
    setLocalVoiceStatus('本机模型单条文字最多 2000 字，请缩短后发送。');
    return;
  }
  if (chatMode === 'remote' && content.length > 4000) {
    setLocalVoiceStatus('云端聊天单条文字最多 4000 字符，请缩短后发送。');
    return;
  }
  if (chatMode !== 'local' && !getValidConfig(config)) {
    openSettings();
    showSettingsError('保存你的 API 地址、模型和 Key 后，就可以开始聊天啦。');
    return;
  }

  transientError = null;
  if (!(retryExisting && history.at(-1)?.role === 'user')) {
    history.push({ role: 'user', content, timestamp: Date.now() });
    persistHistory();
  }
  if (!retryExisting) elements.messageInput.value = '';
  updateCharacterCount();
  renderMessages();
  const controller = new AbortController();
  activeController = controller;
  setBusy(true);

  try {
    if (chatMode === 'local') {
      stopLocalAudio();
      const turnId = `web-${Date.now()}-${++localTurnSequence}`;
      await requestLocalTurn(controller.signal, (socket) => socket.send(JSON.stringify({ type: 'text.input', text: content, turn_id: turnId })), turnId);
      return;
    }
    const recentMessages = history.slice(-MAX_CONTEXT_MESSAGES).map(({ role, content: textContent }) => ({ role, content: textContent.slice(0, 4000) }));
    const payload = { ...config, characterId: character.characterId, messages: recentMessages };
    while (recentMessages.length > 1 && new Blob([JSON.stringify(payload)]).size > 60 * 1024) recentMessages.shift();
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'same-origin',
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error('本机服务返回异常，请刷新页面后重试。');
    }
    if (activeController !== controller || controller.signal.aborted) return;
    if (!response.ok) throw new Error(result?.error || '模型请求失败，请检查连接设置。');
    if (typeof result?.reply !== 'string' || !result.reply.trim()) throw new Error('模型没有返回文字回复。');
    history.push({ role: 'assistant', content: result.reply, timestamp: Date.now() });
    persistHistory();
    speak(result.reply);
  } catch (error) {
    if (activeController === controller && error.name !== 'AbortError') {
      transientError = { role: 'assistant', content: error.message || '连接失败，请检查设置后重试。', timestamp: Date.now(), error: true };
    }
  } finally {
    if (activeController === controller) {
      activeController = null;
      setBusy(false);
      renderMessages();
      elements.messageInput.focus();
    }
  }
}

function retryLastMessage() {
  if (activeController) return;
  transientError = null;
  renderMessages();
  const last = history[history.length - 1];
  if (last?.role === 'user') sendMessage(last.content, true);
}

function updateCharacterCount() {
  const local = chatMode === 'local';
  const count = local ? [...elements.messageInput.value].length : elements.messageInput.value.length;
  elements.characterCount.textContent = chatMode === 'seeduplex' ? '豆包语音模式' : `${count} / ${local ? 2000 : 4000}`;
  elements.messageInput.setAttribute('aria-invalid', String(count > (local ? 2000 : 4000)));
  if (!elements.messageInput.value) elements.messageInput.style.height = 'auto';
  elements.sendButton.disabled = chatMode === 'seeduplex' && !activeController;
}

for (const button of [elements.openSettings, elements.openSettingsSide]) {
  button.addEventListener('click', openSettings);
}
elements.checkVoiceHealth.addEventListener('click', checkVoiceHealth);
elements.localBackendURL.addEventListener('input', () => cancelVoiceHealth('地址已更改，请重新检查。'));
elements.closeSettings.addEventListener('click', () => elements.settingsDialog.close());
elements.settingsDialog.addEventListener('click', (event) => {
  if (event.target === elements.settingsDialog) elements.settingsDialog.close();
});
elements.settingsDialog.addEventListener('close', () => {
  cancelVoiceHealth();
  if (!getValidConfig(config) && !history.length) elements.welcome.hidden = false;
});

document.querySelectorAll('[data-preset]').forEach((button) => {
  button.addEventListener('click', () => {
    const preset = presets[button.dataset.preset];
    if (!preset) return;
    elements.baseURL.value = preset.baseURL;
    elements.model.value = preset.model;
    document.querySelectorAll('[data-preset]').forEach((chip) => chip.classList.toggle('selected', chip === button));
  });
});
elements.imageProvider.addEventListener('change', () => {
  const defaults = elements.imageProvider.value === 'gemini'
    ? { baseURL: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.1-flash-image' }
    : { baseURL: 'https://api.openai.com/v1', model: 'gpt-image-2' };
  elements.imageBaseURL.value = defaults.baseURL;
  elements.imageModel.value = defaults.model;
});

elements.settingsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  showSettingsError('');
  const nextMode = ['local', 'seeduplex', 'remote'].includes(elements.chatMode.value) ? elements.chatMode.value : 'local';
  const nextBackend = getValidLocalBackend(elements.localBackendURL.value);
  if (nextMode !== 'remote' && !nextBackend) {
    showSettingsError('本机后端仅允许无凭据的 HTTP localhost、127.0.0.1 或 [::1] 地址。');
    elements.localBackendURL.focus();
    return;
  }
  const candidate = nextMode !== 'remote' ? config : getValidConfig({
    baseURL: elements.baseURL.value,
    model: elements.model.value,
    apiKey: elements.apiKey.value,
  });
  if (nextMode === 'remote' && !candidate) {
    showSettingsError('请填写有效的服务地址、模型名称和 API Key；外部服务必须使用 HTTPS。');
    return;
  }
  const seedKey = elements.seedAPIKey.value.trim();
  const nextSeedConfig = seedKey ? getValidSeedConfig({ apiKey: seedKey }) : null;
  if (seedKey && !nextSeedConfig) {
    showSettingsError('豆包语音 Key 格式无效，请填写语音控制台的有效 Key。');
    return;
  }
  const imageKey = elements.imageAPIKey.value.trim();
  let nextImageConfig = null;
  if (imageKey) {
    nextImageConfig = getImageConfigFromForm();
    if (!nextImageConfig) {
      showSettingsError('图片服务只支持 Gemini 或 OpenAI Images 兼容协议；请检查地址、模型和图片 Key。');
      return;
    }
  }
  if (!saveSettings([
    [CONFIG_STORAGE_KEY, candidate], [CHAT_MODE_STORAGE_KEY, nextMode],
    [LOCAL_BACKEND_STORAGE_KEY, nextBackend || localBackendBase], [IMAGE_CONFIG_STORAGE_KEY, nextImageConfig],
    [SEED_CONFIG_STORAGE_KEY, null],
  ])) return;
  disconnectLocalVoice();
  config = candidate;
  if (JSON.stringify(imageConfig) !== JSON.stringify(nextImageConfig)) cancelPortrait('图片设置已更改，已取消写真。');
  imageConfig = nextImageConfig;
  seedConfig = nextSeedConfig;
  legacySeedKeyRemoved = true;
  chatMode = nextMode;
  if (nextBackend) localBackendBase = nextBackend;
  updateChatModeUI();
  elements.settingsDialog.close();
  elements.messageInput.focus();
});

function discardLocalRecording() {
  localRecorderGeneration++;
  elements.micButton.disabled = false;
  localRecording = false;
  releaseLocalRecorder();
  localChunks = [];
  localSampleCount = 0;
  elements.micButton.textContent = '语音';
  elements.micButton.setAttribute('aria-label', '开始语音输入');
  elements.messageInput.disabled = chatMode === 'seeduplex';
  updateDuplexUI();
}

function disconnectLocalVoice(cancelTurn = true) {
  duplex.stop();
  duplexDraft = { turnId: '', user: '', reply: '', userSaved: false, replySaved: false };
  renderDuplexCaptions();
  if (cancelTurn) stopGenerating();
  discardLocalRecording();
  stopLocalAudio();
  const socket = localSocket;
  localResetResolver?.(new Error('会话已断开，记忆已随连接释放。'));
  localResetResolver = null;
  localSocket = null;
  localReady = false;
  localConnectPromise = null;
  socket?.close();
  updateConnectionStatus();
}

elements.chatMode.addEventListener('change', () => {
  cancelVoiceHealth();
  const local = elements.chatMode.value !== 'remote';
  elements.seedFields.hidden = elements.chatMode.value !== 'seeduplex';
  elements.localBackendFields.hidden = !local;
  elements.remoteChatFields.hidden = local;
  for (const field of [elements.apiKey, elements.baseURL, elements.model]) field.required = !local;
});
elements.duplexButton.addEventListener('click', async () => {
  if (duplex.active) {
    duplex.stop('通话已结束，麦克风与播放已释放。');
    return;
  }
  if (chatMode !== 'seeduplex' || activeController || localRecording || elements.micButton.disabled || elements.clearLocalMemory.disabled) return;
  if (!supportsDuplex()) { setLocalVoiceStatus('当前设备不支持免提通话，请使用按轮语音。'); return; }
  const baseURL = getValidLocalBackend(localBackendBase);
  if (!baseURL) { setLocalVoiceStatus('本机后端地址无效，请检查设置。'); return; }
  disconnectLocalVoice();
  transientError = null;
  duplexDraft = { turnId: '', user: '', reply: '', userSaved: false, replySaved: false };
  renderDuplexCaptions();
  renderMessages();
  const address = new URL('/api/local-voice', window.location.href);
  address.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  address.searchParams.set('baseURL', baseURL);
  await duplex.start({ url: address.href, profile: character, apiKey: seedConfig?.apiKey || '', outputEnabled: voiceEnabled });
});
elements.micButton.addEventListener('click', async () => {
  if (duplex.active) return;
  if (localRecording) { stopLocalRecording(); return; }
  if (activeController || elements.micButton.disabled || elements.clearLocalMemory.disabled) return;
  const generation = ++localRecorderGeneration;
  elements.micButton.disabled = true;
  updateDuplexUI();
  try {
    stopLocalAudio();
    await startLocalRecording(generation);
    if (generation === localRecorderGeneration) elements.messageInput.disabled = localRecording || chatMode === 'seeduplex';
  } catch (error) {
    if (generation !== localRecorderGeneration) return;
    discardLocalRecording();
    setLocalVoiceStatus(error.message || '无法打开麦克风，请检查浏览器权限。');
  } finally {
    if (generation === localRecorderGeneration) { elements.micButton.disabled = false; updateDuplexUI(); }
  }
});
elements.interruptLocalVoice.addEventListener('click', () => {
  if (duplex.active) { duplex.interrupt(); return; }
  discardLocalRecording();
  stopGenerating();
  stopLocalAudio();
  setLocalVoiceStatus('已停止本轮录音、回复与播放。');
});
elements.clearLocalMemory.addEventListener('click', async () => {
  if (activeController || localRecording || elements.micButton.disabled || elements.clearLocalMemory.disabled) return;
  if (chatMode === 'seeduplex') {
    disconnectLocalVoice();
    setLocalVoiceStatus('已断开豆包语音会话；下次录音会建立新的上下文。页面历史仍保留。');
    return;
  }
  stopLocalAudio();
  elements.clearLocalMemory.disabled = true;
  try {
    await ensureLocalSocket();
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        localResetResolver = null;
        disconnectLocalVoice(false);
        reject(new Error('清空记忆超时，旧连接已断开；下一轮会重新建立空白会话。'));
      }, 10000);
      localResetResolver = (error) => { clearTimeout(timeout); if (error) reject(error); else resolve(); };
      try { localSocket.send(JSON.stringify({ type: 'session.reset' })); }
      catch (error) { clearTimeout(timeout); localResetResolver = null; reject(error); }
    });
  } catch (error) {
    setLocalVoiceStatus(error.message);
  } finally {
    elements.clearLocalMemory.disabled = false;
  }
});

elements.reuseChatKey.addEventListener('click', () => {
  if (!elements.apiKey.value.trim()) {
    showSettingsError('请先在上方填写聊天模型 API Key，再确认该 Key 也能调用图像模型。');
    return;
  }
  elements.imageAPIKey.value = elements.apiKey.value.trim();
  showSettingsError('已暂填聊天 Key；请确认对应账号也已开通图像生成权限。');
});

function closePickerDialog() {
  if (elements.pickerDialog.open) elements.pickerDialog.close();
}
elements.closePicker.addEventListener('click', closePickerDialog);
elements.closePickerDone.addEventListener('click', closePickerDialog);
elements.pickerDialog.addEventListener('click', (event) => {
  if (event.target === elements.pickerDialog) closePickerDialog();
});
for (const button of [elements.chooseAvatar, elements.stageChangeAvatar]) {
  button.addEventListener('click', () => openPicker('avatar'));
}
elements.chooseOutfit.addEventListener('click', () => openPicker('outfit'));
elements.pickerSearch.addEventListener('input', () => { pickerLimit = 35; renderPicker(); });
elements.pickerMore.addEventListener('click', () => { pickerLimit += 35; renderPicker(); });
document.querySelectorAll('[data-avatar-filter]').forEach((button) => {
  button.addEventListener('click', () => {
    avatarFilter = button.dataset.avatarFilter === 'face' ? 'face' : 'styling';
    pickerLimit = 35;
    document.querySelectorAll('[data-avatar-filter]').forEach((item) => item.classList.toggle('selected', item === button));
    renderPicker();
  });
});
document.querySelectorAll('[data-outfit-library]').forEach((button) => {
  button.addEventListener('click', () => {
    outfitLibrary = button.dataset.outfitLibrary === 'anime' ? 'anime' : 'real';
    pickerLimit = 35;
    document.querySelectorAll('[data-outfit-library]').forEach((item) => item.classList.toggle('selected', item === button));
    renderPicker();
  });
});

elements.avatarImage.addEventListener('error', () => {
  if (!generatedObjectURL) return;
  resetGeneratedPreview();
  renderCharacter();
  setPortraitStatus('生成的图片无法显示，已恢复所选头像。请检查图像模型后重试。');
});

for (const item of CHARACTERS) {
  elements.characterSelect.append(Object.assign(document.createElement('option'), { value: item.id, textContent: item.label }));
}
elements.characterSelect.value = character.characterId;
elements.characterSelect.addEventListener('change', async () => {
  const id = elements.characterSelect.value;
  try { await loadCatalog(); changeCharacterAppearance({ kind: 'character', id }); }
  catch (error) { setPortraitStatus(error.message); renderCharacter(); }
});
elements.poseSelect.addEventListener('change', () => {
  changeCharacterAppearance({ kind: 'pose', id: elements.poseSelect.value });
});
elements.voiceToggle.setAttribute('aria-pressed', String(voiceEnabled));
elements.voiceToggle.textContent = voiceEnabled ? '自动朗读 · 开' : '自动朗读 · 关';
elements.voiceToggle.addEventListener('click', () => {
  const nextVoiceEnabled = !voiceEnabled;
  if (!saveStorage(VOICE_STORAGE_KEY, nextVoiceEnabled)) return;
  voiceEnabled = nextVoiceEnabled;
  elements.voiceToggle.setAttribute('aria-pressed', String(voiceEnabled));
  elements.voiceToggle.textContent = voiceEnabled ? '自动朗读 · 开' : '自动朗读 · 关';
  duplex.setPlaybackEnabled(voiceEnabled);
  if (!voiceEnabled) stopLocalAudio(false);
});
elements.mobileStudio.addEventListener('click', () => {
  const open = elements.workspace.classList.toggle('studio-open');
  elements.mobileStudio.setAttribute('aria-expanded', String(open));
  elements.mobileStudio.setAttribute('aria-label', open ? '返回聊天' : '打开形象工作室');
  elements.mobileStudio.textContent = open ? '聊天' : '形象 ✿';
  if (open) void loadCatalog().catch(error => setPortraitStatus(error.message));
});
elements.generateTryOn.addEventListener('click', async () => {
  if (portraitController) {
    cancelPortrait('已取消写真生成。');
    return;
  }
  try {
    await loadCatalog();
  } catch (error) {
    setPortraitStatus(error.message);
    return;
  }
  if (portraitController) return;
  const selectedPortrait = catalog.portraits.find((item) => item.id === character.faceId);
  const selectedOutfit = catalog.outfits.find((item) => item.id === character.outfitId && item.library === character.outfitLibrary);
  if (!selectedPortrait || !selectedOutfit) {
    openPicker(!selectedPortrait ? 'avatar' : 'outfit');
    return;
  }
  let candidateImageConfig = getValidImageConfig(imageConfig);
  if (!candidateImageConfig) {
    if (getImageConfigFromForm() && elements.imageAPIKey.value.trim()) candidateImageConfig = getImageConfigFromForm();
    if (!candidateImageConfig) {
      openSettings();
      showSettingsError('聊天 Key 可用来聊天，但角色换装还需要有图像生成权限的模型 Key。请设置 Gemini 图像模型或 OpenAI Images 兼容模型。');
      return;
    }
  }
  const controller = new AbortController();
  portraitController = controller;
  setPortraitStatus('正在生成高清写真，可继续聊天或录音。');
  elements.generateTryOn.textContent = '正在生成 · 取消';
  elements.avatarStage.classList.add('is-generating');
  try {
    const response = await fetch('/api/tryon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      credentials: 'same-origin',
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
      body: JSON.stringify({
        imageConfig: candidateImageConfig,
        portraitId: character.faceId,
        outfitId: character.outfitId,
        library: character.outfitLibrary,
        pose_id: character.poseId,
      }),
    });
    let result;
    try { result = await response.json(); }
    catch { throw new Error('图片服务返回格式无效，请检查模型接口后重试。'); }
    if (portraitController !== controller || controller.signal.aborted) return;
    if (!response.ok) throw new Error(result?.error || '虚拟形象生成失败。');
    if (!result || typeof result.image !== 'string' || !result.image.length || result.image.length > 24 * 1024 * 1024 || !/^[a-zA-Z0-9+/]+={0,2}$/.test(result.image) || !['image/png', 'image/jpeg', 'image/webp'].includes(result.mimeType)) {
      throw new Error('图片服务没有返回有效图片，请检查图像模型设置后重试。');
    }
    const bytes = Uint8Array.from(atob(result.image), (char) => char.charCodeAt(0));
    const imageBlob = new Blob([bytes], { type: result.mimeType || 'image/png' });
    const imageURL = URL.createObjectURL(imageBlob);
    resetGeneratedPreview();
    generatedObjectURL = imageURL;
    renderCharacter();
    setPortraitStatus('写真生成完成。');
  } catch (error) {
    if (portraitController === controller && error.name !== 'AbortError') {
      setPortraitStatus(`写真生成失败（portrait_generation_failed）：${error.message || '请检查图片模型后手动重试。'}`);
    }
  } finally {
    if (portraitController === controller) {
      portraitController = null;
      finishPortrait();
    }
  }
});

elements.forgetKey.addEventListener('click', () => {
  cancelPortrait('图片模型配置已清除，已取消写真。');
  disconnectLocalVoice();
  config = null;
  imageConfig = null;
  seedConfig = null;
  elements.apiKey.value = '';
  elements.imageAPIKey.value = '';
  elements.seedAPIKey.value = '';
  updateConnectionStatus();
  let removed = true;
  for (const key of [CONFIG_STORAGE_KEY, IMAGE_CONFIG_STORAGE_KEY, SEED_CONFIG_STORAGE_KEY]) {
    try { localStorage.removeItem(key); } catch { removed = false; }
  }
  legacySeedKeyRemoved = removed;
  showSettingsError(removed ? '已移除聊天和图片 Key；当前会话中的豆包语音 Key 已从内存清除。' : '当前任务已停止，但浏览器无法完全移除本地 Key，请在浏览器设置中清除此页面数据。');
});

elements.revealKey.addEventListener('click', () => {
  const show = elements.apiKey.type === 'password';
  elements.apiKey.type = show ? 'text' : 'password';
  elements.revealKey.textContent = show ? '隐藏' : '显示';
  elements.revealKey.setAttribute('aria-label', show ? '隐藏 API Key' : '显示 API Key');
});

elements.composerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (activeController) {
    stopGenerating();
    return;
  }
  sendMessage();
});
elements.messageInput.addEventListener('input', () => {
  elements.messageInput.style.height = 'auto';
  elements.messageInput.style.height = `${Math.min(elements.messageInput.scrollHeight, 130)}px`;
  updateCharacterCount();
});
elements.messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (activeController) stopGenerating();
    else elements.composerForm.requestSubmit();
  }
});

document.querySelectorAll('[data-prompt]').forEach((button) => {
  button.addEventListener('click', () => {
    elements.messageInput.value = button.dataset.prompt || '';
    updateCharacterCount();
    if (chatMode !== 'remote' || getValidConfig(config)) sendMessage(elements.messageInput.value);
    else openSettings();
  });
});

function startNewChat() {
  if (!saveStorage(historyKey(), [])) return;
  disconnectLocalVoice();
  transientError = null;
  history = [];
  renderMessages();
  closeSidebar();
  elements.messageInput.value = '';
  updateCharacterCount();
}
elements.newChat.addEventListener('click', startNewChat);
elements.exportChat.addEventListener('click', exportHistory);
elements.clearChat.addEventListener('click', () => {
  if (!history.length || window.confirm('确定清除保存在这台设备上的聊天记录吗？')) startNewChat();
});

elements.mobileMenu.addEventListener('click', () => {
  const open = !elements.sidebar.classList.contains('open');
  elements.sidebar.classList.toggle('open', open);
  elements.mobileMenu.setAttribute('aria-expanded', String(open));
  elements.mobileScrim.hidden = !open;
  syncSidebarFocus();
  if (open) elements.newChat.focus();
});
elements.mobileScrim.addEventListener('click', () => { closeSidebar(); elements.mobileMenu.focus(); });
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && mobileNavigation?.matches && elements.sidebar.classList.contains('open')) {
    closeSidebar();
    elements.mobileMenu.focus();
  }
});

if (!speechSynthesisAvailable()) {
  elements.voiceToggle.disabled = true;
  elements.voiceToggle.textContent = '语音不可用';
  elements.voiceToggle.setAttribute('aria-pressed', 'false');
} else if (window.speechSynthesis.getVoices().length === 0) {
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    if (window.speechSynthesis.getVoices().length === 0) {
      elements.voiceToggle.title = '设备未提供可用的中文语音';
    }
  }, { once: true });
}

updateChatModeUI();
syncSidebarFocus();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (duplex.active) duplex.stop('页面已隐藏，持续通话已停止；返回后手动开始。');
    discardLocalRecording();
  }
});
window.addEventListener('pagehide', () => { cancelVoiceHealth(); cancelPortrait(); resetGeneratedPreview(); renderCharacter(); disconnectLocalVoice(); });
renderMessages();
updateCharacterCount();
renderCharacter();
loadCatalog().catch(() => {
  elements.avatarCaption.textContent = '打开头像库加载失败';
});
