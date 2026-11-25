const INPUT_RATE = 16000;
const OUTPUT_RATE = 24000;
const MAX_SOCKET_BUFFER = 128 * 1024;
const MAX_AUDIO_FRAME = 64 * 1024;
const MAX_REPLY_BYTES = 32 * 1024 * 1024;
const MAX_TEXT = 8000;
const ERRORS = {
  duplex_not_supported: '当前设备不支持免提通话，请使用“按轮语音”。',
  microphone_denied: '麦克风权限被拒绝或已撤销，请在浏览器和系统设置中允许麦克风。',
  audio_backpressure: '网络或播放持续拥塞，通话已停止；检查网络后手动重新开始。',
  invalid_audio_frame: '语音数据格式无效，通话已停止。',
  seeduplex_timeout: '本轮回复超时，已取消并恢复监听。',
  seeduplex_unavailable: '豆包语音不可用，请检查 Key、账号权限、音色与后端网络后重试。',
  voice_not_configured: '当前角色尚未配置服务端音色，请先配置或选择其他角色。',
  unsupported_character: '后端未确认当前角色的人设和音色，请更新后端或切回知夏。',
};

export function supportsDuplex(environment = globalThis) {
  return typeof environment.AudioContext === 'function'
    && 'audioWorklet' in environment.AudioContext.prototype
    && typeof environment.AudioWorkletNode === 'function'
    && typeof environment.navigator?.mediaDevices?.getUserMedia === 'function';
}

// Callbacks receive only safe state/events; keys remain in the start frame, never in snapshots.
export function createDuplexSession({ onState = () => {}, onEvent = () => {}, onLevel = () => {}, environment = globalThis } = {}) {
  let epoch = 0;
  let socket = null;
  let context = null;
  let stream = null;
  let source = null;
  let capture = null;
  let mute = null;
  let timer = null;
  let active = false;
  let ready = false;
  let state = 'idle';
  let turn = '';
  let audioTurn = '';
  let hasAudio = false;
  let audioEnded = false;
  let serverEnded = false;
  let playbackDrained = false;
  let nextTime = 0;
  let replyBytes = 0;
  let replyText = '';
  let asrText = '';
  let lastCancel = '';
  let blockedSince = null;
  let voiceFrames = 0;
  let quietFrames = 0;
  let activity = false;
  let selectedProfile = null;
  let playbackEnabled = true;
  let startingCapture = false;
  const sources = new Set();
  const retired = new Set();
  const notify = (extra = {}) => onState({ active, ready, state, congested: blockedSince !== null, ...extra });
  const send = (event) => {
    if (ready && socket?.readyState === environment.WebSocket.OPEN) socket.send(JSON.stringify(event));
  };
  function retire(id) {
    if (!id) return;
    retired.add(id);
  }
  function clearPlayback() {
    for (const node of sources) {
      node.onended = null;
      try { node.stop(); } catch { /* Already stopped nodes have no live output. */ }
      node.disconnect();
    }
    sources.clear();
    audioTurn = '';
    nextTime = 0;
    onLevel(0);
  }
  function clearTurn() {
    clearPlayback();
    turn = '';
    hasAudio = audioEnded = serverEnded = playbackDrained = false;
    replyBytes = 0;
    replyText = asrText = '';
  }
  function stop(message = '') {
    epoch++;
    if (timer !== null) environment.clearTimeout(timer);
    timer = null;
    try { send({ type: 'session.stop' }); } catch { /* Closing below releases the session. */ }
    ready = false;
    const previous = socket;
    socket = null;
    if (previous) {
      previous.onopen = previous.onmessage = previous.onerror = previous.onclose = null;
      previous.close(1000, 'session stopped');
    }
    if (capture) {
      capture.port.onmessage = null;
      capture.port.close();
      capture.disconnect();
    }
    capture = null;
    source?.disconnect(); source = null;
    mute?.disconnect(); mute = null;
    stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    stream = null;
    clearTurn();
    if (context && context.state !== 'closed') void context.close();
    context = null;
    startingCapture = false;
    active = false;
    state = 'idle';
    blockedSince = null;
    activity = false;
    voiceFrames = quietFrames = 0;
    lastCancel = '';
    retired.clear();
    notify({ message, code: '' });
  }
  function fail(code) {
    stop();
    notify({ code, message: ERRORS[code] || ERRORS.seeduplex_unavailable });
  }
  function interrupt() {
    if (!active) return;
    const id = audioTurn || turn;
    clearPlayback();
    if (id && lastCancel !== id && !retired.has(id)) {
      lastCancel = id;
      retire(id);
      send({ type: 'assistant.cancel', turn_id: id });
      onEvent({ type: 'assistant.cancel', turn_id: id });
    }
    state = 'listening';
    notify();
  }
  function finishPlayback(id) {
    if (!active || turn !== id || retired.has(id) || !audioEnded || sources.size) return;
    if (!playbackDrained) {
      playbackDrained = true;
      send({ type: 'playback.complete', turn_id: id });
      onLevel(0);
    }
    if (serverEnded) retire(id);
    state = 'listening';
    notify();
  }
  function acceptTurn(id) {
    if (!id || retired.has(id)) return false;
    if (turn === id) return true;
    // Keep all retired IDs for this connection instead of letting a very late event revive one.
    if (retired.size >= 4096) { fail('seeduplex_unavailable'); return false; }
    retire(turn);
    clearTurn();
    turn = id;
    return true;
  }
  function pushAudio(pcm) {
    if (!audioTurn || retired.has(audioTurn) || audioEnded) return;
    if (!pcm.byteLength || pcm.byteLength % 2 || pcm.byteLength > MAX_AUDIO_FRAME || replyBytes + pcm.byteLength > MAX_REPLY_BYTES) throw new Error('invalid_audio_frame');
    replyBytes += pcm.byteLength;
    if (!playbackEnabled) return;
    const duration = pcm.byteLength / 2 / OUTPUT_RATE;
    if (Math.max(0, nextTime - context.currentTime) + duration > 8 || sources.size >= 512) throw new Error('audio_backpressure');
    const buffer = context.createBuffer(1, pcm.byteLength / 2, OUTPUT_RATE);
    const samples = buffer.getChannelData(0);
    const view = new DataView(pcm);
    let squared = 0;
    for (let i = 0; i < samples.length; i++) { samples[i] = view.getInt16(i * 2, true) / 32768; squared += samples[i] * samples[i]; }
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.connect(context.destination);
    const generation = epoch;
    const id = turn;
    node.onended = () => {
      node.disconnect();
      sources.delete(node);
      if (generation === epoch && turn === id) finishPlayback(id);
    };
    sources.add(node);
    nextTime = Math.max(nextTime, context.currentTime + (sources.size === 1 ? 0.08 : 0));
    node.start(nextTime);
    nextTime += duration;
    onLevel(Math.sqrt(squared / samples.length));
    state = 'playing';
    notify();
  }
  async function startCapture(generation) {
    if (stream || startingCapture) return;
    startingCapture = true;
    try {
      const media = await environment.navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (generation !== epoch) { media.getTracks().forEach(track => track.stop()); return; }
      stream = media;
      media.getTracks().forEach(track => { track.onended = () => { if (generation === epoch) fail('microphone_denied'); }; });
      await context.audioWorklet.addModule('/duplex-capture.worklet.js');
      if (generation !== epoch) return;
      source = context.createMediaStreamSource(media);
      capture = new environment.AudioWorkletNode(context, 'pcm-capture');
      mute = context.createGain();
      mute.gain.value = 0;
      capture.port.onmessage = ({ data }) => {
        if (generation !== epoch || !ready || !data || !(data.pcm instanceof ArrayBuffer) || data.pcm.byteLength !== 640 || !Number.isFinite(data.rms) || !Number.isFinite(data.peak)) return;
        if (socket.bufferedAmount > MAX_SOCKET_BUFFER) {
          if (blockedSince === null) blockedSince = Date.now();
          notify();
          if (Date.now() - blockedSince > 3000) fail('audio_backpressure');
          return;
        }
        if (blockedSince !== null) { blockedSince = null; notify(); }
        try { socket.send(data.pcm); } catch { fail('seeduplex_unavailable'); return; }
        if (data.rms > 0.025) {
          voiceFrames++; quietFrames = 0;
          if (!activity && voiceFrames >= 3) {
            activity = true;
            if (audioTurn || state === 'playing' || state === 'thinking') interrupt();
            send({ type: 'input.activity', active: true });
          }
        } else {
          voiceFrames = 0;
          if (activity && ++quietFrames >= 15) { activity = false; send({ type: 'input.activity', active: false }); }
        }
      };
      source.connect(capture); capture.connect(mute); mute.connect(context.destination);
      state = 'listening';
      notify();
    } catch (error) {
      if (generation === epoch) fail(['NotAllowedError', 'SecurityError'].includes(error?.name) ? 'microphone_denied' : 'seeduplex_unavailable');
    } finally {
      if (generation === epoch) startingCapture = false;
    }
  }
  function handle(event, generation) {
    if (event.type === 'session.ready') {
      if (event.streaming !== true || event.input_rate !== INPUT_RATE || event.output_rate !== OUTPUT_RATE || (event.codec !== undefined && event.codec !== 'pcm_s16le') || (event.channels !== undefined && event.channels !== 1)) throw new Error('duplex_not_supported');
      if (['character_id', 'persona_id', 'voice_id'].some(key => event[key] !== selectedProfile[key])) throw new Error('unsupported_character');
      ready = true;
      if (timer !== null) environment.clearTimeout(timer);
      timer = null;
      if (state === 'connecting' && stream) state = 'listening';
      notify();
      void startCapture(generation);
      return;
    }
    if (event.turn_id && retired.has(event.turn_id)) return;
    if (event.type === 'error') {
      if (event.code === 'seeduplex_timeout') { interrupt(); notify({ code: event.code, message: ERRORS.seeduplex_timeout }); }
      else fail(event.code || 'seeduplex_unavailable');
      return;
    }
    if (!ready) return;
    const id = event.turn_id;
    if (event.type === 'input.speech.started') {
      if (!acceptTurn(id)) return;
      state = 'speaking'; notify(); onEvent(event); return;
    }
    if (!id || id !== turn || retired.has(id)) return;
    switch (event.type) {
      case 'input.speech.stopped': state = 'thinking'; notify(); break;
      case 'asr.delta':
        asrText += event.text || '';
        if (asrText.length > MAX_TEXT) throw new Error('invalid_audio_frame');
        break;
      case 'asr.final':
        asrText = event.text || asrText;
        if (!asrText.trim() || asrText.length > MAX_TEXT) throw new Error('invalid_audio_frame');
        break;
      case 'assistant.text.delta':
        replyText += event.text || '';
        if (replyText.length > MAX_TEXT) throw new Error('invalid_audio_frame');
        break;
      case 'assistant.text.final':
        replyText = event.text || replyText;
        if (replyText.length > MAX_TEXT) throw new Error('invalid_audio_frame');
        break;
      case 'assistant.audio.start':
        if (hasAudio) return;
        if (event.sample_rate !== OUTPUT_RATE || event.channels !== 1 || event.codec !== 'pcm_s16le') throw new Error('invalid_audio_frame');
        hasAudio = true; audioTurn = id; break;
      case 'assistant.audio.end': audioEnded = true; audioTurn = ''; finishPlayback(id); break;
      case 'assistant.cancel': clearPlayback(); retire(id); state = 'listening'; notify(); break;
      case 'turn.end':
        serverEnded = true;
        if (!hasAudio || playbackDrained) retire(id);
        if (state !== 'playing') { state = 'listening'; notify(); }
        break;
      default: return;
    }
    onEvent({ ...event, ...(event.type.startsWith('asr.') ? { text: asrText } : event.type.startsWith('assistant.text.') || event.type === 'turn.end' ? { text: replyText } : {}) });
  }
  async function start({ url, profile, apiKey = '', outputEnabled = true }) {
    stop();
    if (!supportsDuplex(environment)) { fail('duplex_not_supported'); return false; }
    let address;
    try { address = new URL(url, environment.location.href); } catch { fail('seeduplex_unavailable'); return false; }
    if (address.origin.replace(/^ws/, 'http') !== environment.location.origin || !['ws:', 'wss:'].includes(address.protocol) || address.pathname !== '/api/local-voice' || address.username || address.password || address.hash) { fail('seeduplex_unavailable'); return false; }
    if (!profile || !['zhixia', 'linxi'].includes(profile.characterId) || profile.personaId !== profile.characterId || profile.voiceId !== profile.characterId) { fail('unsupported_character'); return false; }
    selectedProfile = { character_id: profile.characterId, persona_id: profile.personaId, voice_id: profile.voiceId };
    playbackEnabled = outputEnabled;
    const generation = epoch;
    active = true; state = 'connecting'; notify();
    try {
      context = new environment.AudioContext();
      await context.resume();
      if (generation !== epoch) return false;
      const connection = new environment.WebSocket(address.href);
      socket = connection; connection.binaryType = 'arraybuffer';
      timer = environment.setTimeout(() => { if (generation === epoch) fail('seeduplex_unavailable'); }, 15000);
      connection.onopen = () => {
        if (generation === epoch) connection.send(JSON.stringify({ type: 'session.start', provider: 'seeduplex', codec: 'pcm_s16le', input_rate: INPUT_RATE, output_rate: OUTPUT_RATE, streaming: true, client_vad: true, ...selectedProfile, ...(apiKey ? { api_key: apiKey } : {}) }));
      };
      connection.onmessage = ({ data }) => {
        if (generation !== epoch) return;
        try {
          if (data instanceof ArrayBuffer) { pushAudio(data); return; }
          if (typeof data !== 'string' || data.length > 64 * 1024) throw new Error('invalid_audio_frame');
          const event = JSON.parse(data);
          if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string') throw new Error('invalid_audio_frame');
          for (const key of ['turn_id', 'text', 'code', 'character_id', 'persona_id', 'voice_id']) {
            if (event[key] !== undefined && typeof event[key] !== 'string') throw new Error('invalid_audio_frame');
          }
          if (event.turn_id?.length > 64) throw new Error('invalid_audio_frame');
          handle(event, generation);
        } catch (error) { fail(error?.message || 'invalid_audio_frame'); }
      };
      connection.onerror = connection.onclose = () => { if (generation === epoch) fail('seeduplex_unavailable'); };
      return true;
    } catch { if (generation === epoch) fail('seeduplex_unavailable'); return false; }
  }
  function setPlaybackEnabled(enabled) {
    playbackEnabled = Boolean(enabled);
    if (!playbackEnabled) {
      clearPlayback();
      if (hasAudio && !audioEnded) audioTurn = turn;
      if (active) { state = 'listening'; notify(); }
      finishPlayback(turn);
    }
  }
  return { start, stop, interrupt, setPlaybackEnabled, get active() { return active; }, get state() { return state; } };
}
