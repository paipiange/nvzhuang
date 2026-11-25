import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import * as characterState from '../app/src/composables/character/character-state.mjs';
import * as duplexSession from './duplex-session.mjs';
import { createAppServer } from './server.mjs';

// Resolve browser-only root import URLs to their real Node modules, then run app.js with VM browser APIs.
const browserModules = new Map([['/character-state.mjs', characterState], ['/duplex-session.mjs', duplexSession]]);
const imports = {};
const source = (await readFile(new URL('./app.js', import.meta.url), 'utf8')).replace(/^import \{ ([\w, ]+) \} from '([^']+)';$/gm, (_line, names, url) => {
  const module = browserModules.get(url);
  assert.ok(module, `unmapped browser module ${url}`);
  for (const name of names.split(', ')) {
    assert.ok(Object.hasOwn(module, name), `missing ${name} export from ${url}`);
    imports[name] = module[name];
  }
  return '';
});
const key = (name) => `mori-companion-${name}-v1`;
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
class Element {
  constructor() {
    Object.assign(this, { value: '', textContent: '', hidden: false, disabled: false,
      required: false, open: false, children: [], dataset: {}, style: {}, options: [],
      scrollHeight: 100, attributes: new Map(), listeners: new Map() });
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle(name, force = !classes.has(name)) {
        if (force) classes.add(name); else classes.delete(name);
        return force;
      },
    };
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  async emit(type, fields = {}) {
    await Promise.all((this.listeners.get(type) || []).map((fn) => fn({ target: this, preventDefault() {}, ...fields })));
    await flush();
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  requestSubmit() { return this.emit('submit'); }
}
function browser({ saved = {}, rawSaved = {}, getUserMedia, fetchImpl, storageFailure, speech = false, now, audioFailure, clickFailure, dateClass, worklet = false } = {}) {
  const nodes = new Map();
  const el = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, new Element());
    return nodes.get(selector);
  };
  const storage = new Map([...Object.entries(saved).map(([name, value]) => [name, JSON.stringify(value)]), ...Object.entries(rawSaved)]);
  const filterGroups = new Map([
    ['[data-avatar-filter]', ['styling', 'face'].map(value => Object.assign(new Element(), { dataset: { avatarFilter: value } }))],
    ['[data-outfit-library]', ['real', 'anime'].map(value => Object.assign(new Element(), { dataset: { outfitLibrary: value } }))],
  ]);
  el('#typing-indicator').hidden = true;
  el('#pose-select').options = ['natural', 'wave', 'heart', 'peace', 'sitting', 'profile'].map(value => ({ value }));
  const sockets = [], requests = [], processors = [], tracks = [], audio = [], revoked = [], utterances = [], contexts = [], created = [], worklets = [];
  let speechCancellations = 0;
  const objectURLs = new Map();
  const timers = new Map();
  let timerId = 0, micRequests = 0, urlId = 0;
  class MockURL extends URL {
    static createObjectURL(blob) {
      const url = `blob:http://localhost:3000/audio-${++urlId}`;
      objectURLs.set(url, blob);
      return url;
    }
    static revokeObjectURL(url) { revoked.push(url); }
  }
  class AudioMock {
    constructor(src) { this.src = src; this.paused = false; audio.push(this); }
    play() { return new Promise((resolve, reject) => { this.resolvePlay = resolve; this.rejectPlay = reject; }); }
    pause() { this.paused = true; }
  }
  class Socket {
    static OPEN = 1;
    constructor(url) { this.url = String(url); this.readyState = 0; this.bufferedAmount = 0; this.sent = []; sockets.push(this); }
    send(data) {
      assert.equal(this.readyState, Socket.OPEN, 'send requires an open socket');
      this.sent.push(typeof data === 'string' ? JSON.parse(data) : data);
    }
    open() { this.readyState = Socket.OPEN; this.onopen?.(); }
    receive(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
    receiveAudio(data) { this.onmessage?.({ data }); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  class AudioContextMock {
    constructor() { audioFailure?.('constructor'); this.sampleRate = 48000; this.state = 'running'; this.destination = {}; contexts.push(this); }
    async resume() { audioFailure?.('resume'); }
    async close() { this.state = 'closed'; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() {
      const processor = { connect() {}, disconnect() {} }; processors.push(processor); return processor;
    }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
    createBuffer(_channels, length, rate) {
      const samples = new Float32Array(length);
      return { duration: length / rate, getChannelData: () => samples };
    }
    createBufferSource() {
      const player = { connect() {}, disconnect() { this.disconnected = true; }, start() {}, stop() { this.stopped = true; } };
      (this.players ??= []).push(player);
      return player;
    }
    currentTime = 0;
  }
  class WorkletNode {
    constructor(_context, name) {
      this.name = name;
      this.port = { onmessage: null, close: () => { this.closed = true; } };
      worklets.push(this);
    }
    connect() {}
    disconnect() { this.disconnected = true; }
    capture(rms = 0) { this.port.onmessage?.({ data: { pcm: new ArrayBuffer(640), rms, peak: rms } }); }
  }
  if (worklet) Object.defineProperty(AudioContextMock.prototype, 'audioWorklet', {
    get() { return { addModule: async () => {} }; },
  });
  const stream = () => {
    const track = { stopped: false, stop() { this.stopped = true; } }; tracks.push(track);
    return { getTracks: () => [track] };
  };
  const windowEvents = new Element(), documentEvents = new Element();
  const window = { location: new URL('http://localhost:3000/'), addEventListener: windowEvents.addEventListener.bind(windowEvents), confirm: () => true };
  class Utterance { constructor(text) { this.text = text; } }
  if (speech) {
    window.SpeechSynthesisUtterance = Utterance;
    window.speechSynthesis = {
      getVoices: () => [{ lang: 'zh-CN', name: 'Test Chinese' }],
      cancel: () => { speechCancellations++; }, speak: value => utterances.push(value), addEventListener() {},
    };
  }
  const context = vm.createContext({
    ...imports, window, location: window.location, document: { hidden: false, addEventListener: documentEvents.addEventListener.bind(documentEvents), body: new Element(), querySelector: el, querySelectorAll: selector => filterGroups.get(selector) || [],
      createElement: tag => { const element = new Element(); element.tag = tag; element.click = () => { clickFailure?.(tag); element.clicked = true; }; created.push(element); return element; }, createDocumentFragment: () => new Element() },
    localStorage: { getItem: (name) => storage.get(name) ?? null,
      setItem: (name, value) => { storageFailure?.('set', name, value); storage.set(name, value); },
      removeItem: (name) => { storageFailure?.('remove', name); storage.delete(name); } },
    WebSocket: Socket, AudioContext: AudioContextMock, ...(worklet ? { AudioWorkletNode: WorkletNode } : {}),
    navigator: { mediaDevices: { async getUserMedia() { micRequests++; return getUserMedia ? getUserMedia(stream) : stream(); } } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (fetchImpl) return fetchImpl(url, options);
      if (url === '/api/catalog') return { ok: true, json: async () => ({ portraits: [], outfits: [] }) };
      throw new Error(`Unexpected HTTP request: ${url}`);
    },
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => timers.delete(id), requestAnimationFrame: (fn) => fn(),
    URL: MockURL, Audio: AudioMock, Blob, AbortController, DOMException, ArrayBuffer, DataView, Float32Array, Uint8Array, console,
    atob, SpeechSynthesisUtterance: Utterance,
    ...(dateClass ? { Date: dateClass } : now === undefined ? {} : { Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } } }),
  });
  context.createDuplexSession = options => imports.createDuplexSession({ ...options, environment: context });
  context.supportsDuplex = () => imports.supportsDuplex(context);
  vm.runInContext(source, context, { filename: 'girlfriend/app.js' });
  return {
    el, sockets, requests, processors, tracks, timers, audio, objectURLs, revoked, utterances, filterGroups, contexts, created, worklets,
    async hide() { context.document.hidden = true; await documentEvents.emit('visibilitychange'); },
    async pagehide() { await windowEvents.emit('pagehide'); },
    get speechCancellations() { return speechCancellations; },
    async expire(ms) {
      const timer = [...timers].find(([, entry]) => entry.ms === ms);
      assert.ok(timer, `expected a ${ms} ms timer`);
      timers.delete(timer[0]);
      timer[1].fn();
      await flush();
    },
    get micRequests() { return micRequests; },
    stored: (name) => storage.has(key(name)) ? JSON.parse(storage.get(key(name))) : undefined,
    async ready(socket = sockets.at(-1), provider = 'local') {
      assert.ok(socket, 'voice socket created'); socket.open();
      assert.equal(socket.sent[0].type, 'session.start');
      assert.equal(socket.sent[0].provider, provider);
      const { character_id, persona_id, voice_id } = socket.sent[0];
      socket.receive({ type: 'session.ready', character_id, persona_id, voice_id }); await flush(); return socket;
    },
    async send(text) { el('#message-input').value = text; await el('#composer-form').emit('submit'); },
  };
}
test('local text limit counts Unicode characters and rejects above 2000', async () => {
  const app = browser();
  await app.send('你'.repeat(2001));
  assert.equal(app.sockets.length, 0); assert.equal(app.stored('chat'), undefined);
  assert.match(app.el('#local-voice-status').textContent, /2000/);
  const text = '🙂'.repeat(2000);
  await app.send(text); const socket = await app.ready();
  assert.equal(socket.sent[1].text, text);
  reply(socket, '收到'); await flush(); assertIdle(app);
});

test('local server error without turn.end immediately finishes the turn', async () => {
  const app = browser(); await app.send('测试错误'); const socket = await app.ready();
  socket.receive({ type: 'error', message: '模型服务不可用' }); await flush();
  assertIdle(app); assert.equal(app.timers.size, 0);
  assert.equal(app.stored('chat').length, 1);
  const messages = app.el('#messages').children;
  assert.equal(messages.length, 2);
  assert.equal(messages[1].children[1].children[1].textContent, '模型服务不可用');
});

test('session startup error without session.ready immediately unlocks composer', async () => {
  const app = browser(); await app.send('建立连接'); const socket = app.sockets[0];
  socket.open(); socket.receive({ type: 'error', message: '无法启动本机模型' }); await flush();
  assertIdle(app); assert.equal(app.timers.size, 0); assert.equal(socket.readyState, 3);
});

test('interrupt during pending microphone permission releases the eventual stream', async () => {
  let grantPermission;
  const app = browser({ getUserMedia: (stream) => new Promise((resolve) => { grantPermission = () => resolve(stream()); }) });
  const starting = app.el('#mic-button').emit('click'); await app.ready();
  assert.equal(app.micRequests, 1);
  await app.el('#interrupt-local-voice').emit('click');
  assert.equal(app.el('#mic-button').disabled, false);
  await app.send('权限未返回也可以继续聊');
  const socket = app.sockets[0];
  assert.equal(socket.sent.at(-1).text, '权限未返回也可以继续聊');
  assert.equal(app.el('#message-input').disabled, true);
  grantPermission(); await starting;
  assert.equal(app.tracks[0].stopped, true); assert.equal(app.processors.length, 0);
  assert.equal(app.el('#message-input').disabled, true, 'late permission must not unlock the newer turn');
  reply(socket, '收到'); await flush(); assertIdle(app);
  assert.equal(app.el('#mic-button').disabled, false); assert.equal(app.timers.size, 0);
});

test('late close of old socket does not disconnect the new session', async () => {
  const app = browser(); await app.send('旧会话'); const old = await app.ready(); reply(old, '完成'); await flush();
  await app.el('#new-chat').emit('click'); await app.send('新会话'); const fresh = await app.ready();
  old.onclose();
  assert.equal(app.el('#connection-label').textContent, '本机后端已连接');
  assert.match(app.el('#local-voice-status').textContent, /模型服务状态会在发言时验证/);
  reply(fresh, '新会话成功'); await flush(); assertIdle(app);
  assert.equal(app.stored('chat').at(-1).content, '新会话成功');
});

function assertIdle(app) {
  assert.equal(app.el('#message-input').disabled, false);
  assert.equal(app.el('#typing-indicator').hidden, true);
}
function reply(socket, text) {
  const turn_id = socket.sent.findLast((item) => item.type === 'text.input' || item.type === 'input.end')?.turn_id;
  socket.receive({ type: 'assistant.text.delta', text, turn_id });
  socket.receive({ type: 'turn.end', turn_id });
}

test('default local settings save without cloud key', async () => {
  const app = browser(); await app.el('#open-settings').emit('click');
  assert.equal(app.el('#chat-mode').value, 'local');
  assert.equal(app.el('#remote-chat-fields').hidden, true);
  for (const name of ['#api-key', '#base-url', '#model-name']) assert.equal(app.el(name).required, false);
  await app.el('#settings-form').emit('submit');
  assert.equal(app.stored('chat-mode'), 'local');
  assert.equal(app.stored('local-backend'), 'http://127.0.0.1:8000');
  assert.equal(app.stored('model'), undefined);
  assert.equal(app.el('#settings-dialog').open, false);
  assert.equal(app.el('#form-error').hidden, true);
});

test('new installations prefer local chat even when an old cloud model key exists', async () => {
  const app = browser({ saved: { [key('model')]: { baseURL: 'https://api.example.com/v1', model: 'old-cloud-model', apiKey: 'test-only' } } });
  await app.el('#open-settings').emit('click');
  assert.equal(app.el('#chat-mode').value, 'local');
  assert.equal(app.el('#remote-chat-fields').hidden, true);
  assert.equal(app.el('#message-input').disabled, false);
});

test('an explicitly saved remote preference is retained', async () => {
  const app = browser({ saved: {
    [key('chat-mode')]: 'remote',
    [key('model')]: { baseURL: 'https://api.example.com/v1', model: 'saved-model', apiKey: 'test-only' },
  } });
  await app.el('#open-settings').emit('click');
  assert.equal(app.el('#chat-mode').value, 'remote');
  assert.equal(app.el('#remote-chat-fields').hidden, false);
});

test('remote settings require each cloud field and save valid values', async () => {
  const app = browser(); await app.el('#open-settings').emit('click');
  app.el('#chat-mode').value = 'remote'; await app.el('#chat-mode').emit('change');
  const valid = { '#base-url': 'https://example.com/v1', '#model-name': 'test-model', '#api-key': 'test-placeholder' };
  for (const name of Object.keys(valid)) assert.equal(app.el(name).required, true);
  for (const missing of Object.keys(valid)) {
    for (const [name, value] of Object.entries(valid)) app.el(name).value = name === missing ? '' : value;
    await app.el('#settings-form').emit('submit');
    assert.match(app.el('#form-error').textContent, /API Key/);
    assert.equal(app.el('#settings-dialog').open, true); assert.equal(app.stored('model'), undefined);
  }
  for (const [name, value] of Object.entries(valid)) app.el(name).value = value;
  await app.el('#settings-form').emit('submit');
  assert.equal(app.stored('chat-mode'), 'remote'); assert.equal(app.stored('model').apiKey, 'test-placeholder');
  assert.equal(app.el('#settings-dialog').open, false);
});

test('local composer sends text.input through same-origin websocket and renders reply', async () => {
  const app = browser(); await app.send('  你好  '); const socket = await app.ready();
  const url = new URL(socket.url);
  assert.equal(url.origin, 'ws://localhost:3000'); assert.equal(url.pathname, '/api/local-voice');
  assert.equal(url.searchParams.get('baseURL'), 'http://127.0.0.1:8000');
  assert.equal(socket.sent[1].type, 'text.input'); assert.equal(socket.sent[1].text, '你好');
  assert.match(socket.sent[1].turn_id, /^web-/);
  socket.receive({ type: 'assistant.text.delta', text: '你好，', turn_id: socket.sent[1].turn_id });
  reply(socket, '很高兴见到你。'); await flush();
  assert.equal(app.stored('chat').at(-1).content, '你好，很高兴见到你。');
  assert.equal(app.el('#messages').children.length, 2); assertIdle(app);
  assert.equal(app.requests.some(({ url: path }) => path === '/api/chat'), false);
  assert.equal(app.timers.size, 0);
});

test('mic sends 16k PCM and input.end, applies ASR and renders response', async () => {
  const app = browser(); const starting = app.el('#mic-button').emit('click');
  const socket = await app.ready(); await starting;
  assert.equal(app.micRequests, 1); assert.equal(app.el('#message-input').disabled, true);
  app.processors[0].onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(4800).fill(0.1) } });
  await app.el('#mic-button').emit('click');
  assert.ok(socket.sent[1] instanceof ArrayBuffer); assert.equal(socket.sent[1].byteLength, 3200);
  assert.equal(socket.sent[2].type, 'input.end'); assert.equal(app.tracks[0].stopped, true);
  socket.receive({ type: 'asr.final', text: '今天好吗', turn_id: socket.sent[2].turn_id });
  reply(socket, '很好呀'); await flush();
  assert.equal(app.stored('chat')[0].content, '今天好吗'); assert.equal(app.stored('chat')[1].content, '很好呀');
  assertIdle(app); assert.equal(app.timers.size, 0);
});

test('interrupt cancels pending response and ignores its late reply', async () => {
  const app = browser(); await app.send('等待回复'); const socket = await app.ready();
  await app.el('#interrupt-local-voice').emit('click');
  assert.equal(socket.sent.at(-1).type, 'assistant.cancel'); assertIdle(app);
  reply(socket, '迟到的回复'); await flush(); assert.equal(app.stored('chat').length, 1);
  assert.equal(app.timers.size, 0);
});

test('interrupt stops microphone without submitting a turn', async () => {
  const app = browser(); const starting = app.el('#mic-button').emit('click');
  const socket = await app.ready(); await starting; await app.el('#interrupt-local-voice').emit('click');
  assert.equal(app.tracks[0].stopped, true); assert.equal(app.processors[0].onaudioprocess, null);
  assert.equal(app.el('#message-input').disabled, false); assert.equal(socket.sent.length, 1);
  assert.equal(app.timers.size, 0);
});

test('clear memory sends session.reset and waits for acknowledgement', async () => {
  const app = browser(); const clearing = app.el('#clear-local-memory').emit('click');
  const socket = await app.ready(); assert.equal(socket.sent.at(-1).type, 'session.reset');
  assert.equal(app.el('#clear-local-memory').disabled, true); socket.receive({ type: 'session.reset' });
  await clearing; assert.equal(app.el('#clear-local-memory').disabled, false);
  assert.match(app.el('#local-voice-status').textContent, /记忆已清空/); assert.equal(app.timers.size, 0);
});

for (const outcome of ['disconnect', 'cancel']) {
  test(`before ASR, ${outcome} removes the placeholder without persisting or retrying it`, async () => {
    const app = browser();
    const starting = app.el('#mic-button').emit('click');
    const socket = await app.ready(); await starting;
    app.processors[0].onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(4800).fill(0.1) } });
    await app.el('#mic-button').emit('click');
    const turn_id = socket.sent.at(-1).turn_id;
    assert.equal(app.el('#messages').children.length, 1);
    assert.equal(app.stored('chat'), undefined);
    if (outcome === 'disconnect') socket.close();
    else await app.el('#interrupt-local-voice').emit('click');
    await flush();
    socket.receive({ type: 'asr.final', text: '迟到字幕', turn_id });
    assert.equal(app.stored('chat'), undefined);
    const rows = app.el('#messages').children;
    if (outcome === 'disconnect') {
      assert.equal(rows.length, 1);
      assert.match(rows[0].children[1].children[1].textContent, /重新录音/);
      assert.equal(rows[0].children[1].children.length, 3, 'failed voice row must not expose text retry');
    } else {
      assert.equal(rows.length, 0);
      assert.equal(socket.sent.at(-1).type, 'assistant.cancel');
    }
    assertIdle(app); assert.equal(app.timers.size, 0);
  });
}

function sendAudio(socket, bytes = new ArrayBuffer(48)) {
  const turn_id = socket.sent.findLast((item) => item.type === 'text.input').turn_id;
  socket.receive({ type: 'assistant.audio.start', turn_id });
  socket.receiveAudio(bytes);
  socket.receive({ type: 'assistant.audio.end', turn_id });
}

test('audio segments play in order and disabling playback revokes current and queued URLs', async () => {
  const app = browser(); await app.send('播放'); const socket = await app.ready();
  sendAudio(socket); sendAudio(socket); sendAudio(socket);
  const [firstURL, secondURL, queuedURL] = app.objectURLs.keys();
  assert.equal(app.objectURLs.get(firstURL).type, 'audio/wav');
  assert.deepEqual(app.audio.map(({ src }) => src), [firstURL]);
  app.audio[0].onended();
  assert.deepEqual(app.revoked, [firstURL]);
  assert.deepEqual(app.audio.map(({ src }) => src), [firstURL, secondURL]);
  await app.el('#voice-toggle').emit('click');
  assert.equal(app.audio[1].paused, true);
  assert.deepEqual(app.revoked, [firstURL, secondURL, queuedURL]);
  sendAudio(socket);
  assert.equal(app.objectURLs.size, 3);
  reply(socket, '只显示文字'); await flush(); assertIdle(app);
});

test('late play rejection after interrupt cannot change status or interrupt newer audio', async () => {
  const app = browser(); await app.send('旧音频'); const socket = await app.ready();
  sendAudio(socket);
  const old = app.audio[0];
  await app.el('#interrupt-local-voice').emit('click');
  await app.send('新音频'); sendAudio(socket); sendAudio(socket);
  const current = app.audio[1];
  const status = app.el('#local-voice-status').textContent;
  old.rejectPlay(new Error('play interrupted by pause')); await flush();
  assert.equal(app.el('#local-voice-status').textContent, status);
  assert.equal(current.paused, false);
  assert.equal(app.audio.length, 2);
  assert.deepEqual(app.revoked, [old.src]);
  current.onended();
  assert.equal(app.audio.length, 3);
  app.audio[2].onended();
  reply(socket, '完成'); await flush(); assertIdle(app);
});

test('a timed-out local turn closes its socket and the next turn reconnects', async () => {
  const app = browser(); await app.send('会超时'); const old = await app.ready();
  await app.expire(120000);
  assert.equal(old.readyState, 3); assertIdle(app);
  assert.match(app.el('#messages').children.at(-1).children[1].children[1].textContent, /超时/);
  await app.send('继续'); const fresh = await app.ready();
  assert.notEqual(fresh, old);
  reply(fresh, '新会话'); await flush(); assertIdle(app);
  assert.equal(app.stored('chat').at(-1).content, '新会话');
  assert.equal(app.timers.size, 0);
});

test('WebSocket startup error closes the failed socket and allows reconnect', async () => {
  const app = browser(); await app.send('连接失败'); const old = app.sockets[0];
  old.onerror(); await flush();
  assert.equal(old.readyState, 3); assertIdle(app);
  await app.send('重连'); const fresh = await app.ready();
  assert.notEqual(fresh, old);
  reply(fresh, '已连接'); await flush(); assertIdle(app);
  assert.equal(app.timers.size, 0);
});

test('audio limit is cumulative across segments and rejects before turn.end', async () => {
  const app = browser({ saved: { [key('voice')]: false } });
  await app.send('音频过大'); const socket = await app.ready();
  const chunk = new ArrayBuffer(16 * 1024 * 1024);
  sendAudio(socket, chunk); sendAudio(socket, chunk);
  assert.equal(app.el('#message-input').disabled, true, 'exactly 32 MiB is allowed');
  sendAudio(socket, new ArrayBuffer(2)); await flush();
  assert.equal(socket.sent.at(-1).type, 'assistant.cancel');
  assert.match(app.el('#messages').children.at(-1).children[1].children[1].textContent, /32 MiB/);
  assert.equal(app.stored('chat').length, 1);
  assert.equal(app.timers.size, 0); assertIdle(app);
  reply(socket, '迟到回复'); await flush();
  assert.equal(app.stored('chat').length, 1);
});

test('clear memory rejects immediately when its socket closes without acknowledgement', async () => {
  const app = browser(); const clearing = app.el('#clear-local-memory').emit('click');
  const socket = await app.ready();
  assert.equal(socket.sent.at(-1).type, 'session.reset');
  socket.close(); await flush();
  assert.equal(app.el('#clear-local-memory').disabled, false);
  await clearing;
  assert.match(app.el('#local-voice-status').textContent, /断开/);
  assert.equal(app.timers.size, 0);
});

test('new chat clears history and replaces the local session', async () => {
  const app = browser(); await app.send('旧对话'); const old = await app.ready(); reply(old, '旧回复'); await flush();
  await app.el('#new-chat').emit('click'); assert.equal(old.readyState, 3);
  assert.deepEqual(app.stored('chat'), []); assert.equal(app.el('#messages').children.length, 0);
  assert.equal(app.el('#welcome').hidden, false); assert.equal(app.el('#message-input').value, '');
  await app.send('新的开始'); assert.equal(app.sockets.length, 2); const fresh = await app.ready();
  assert.notEqual(fresh, old); assert.equal(fresh.sent[1].text, '新的开始'); reply(fresh, '新回复'); await flush();
  assert.equal(app.stored('chat').length, 2); assert.equal(app.stored('chat')[1].content, '新回复');
  assertIdle(app); assert.equal(app.timers.size, 0);
});

const cloudConfig = { baseURL: 'https://example.com/v1', model: 'test-chat', apiKey: 'test-placeholder' };
const imageConfig = { provider: 'openai', baseURL: 'https://example.com/v1', model: 'test-image', apiKey: 'image-placeholder' };
const fixtureCatalog = {
  portraits: [
    { id: 'f000a1c4200', section: 'styling', label: '全身', style: '自然', image: '/assets/portrait/default.webp' },
    { id: 'f000a1c4201', section: 'face', label: '面部', hair: '短发', image: '/assets/portrait/face.webp' },
    { id: 'f71f980dde3', section: 'face', label: '林溪', image: '/assets/portrait/linxi.webp' },
  ],
  outfits: [
    { id: 'SPR-0001', library: 'real', category: '春装', image: '/assets/outfit/default.webp' },
    { id: 'ANI-0001', library: 'anime', category: '动漫裙装', image: '/assets/outfit/anime.webp' },
    { id: 'SPR-0002', library: 'anime', category: '春装', image: '/assets/outfit/linxi.webp' },
  ],
};
const jsonResponse = value => ({ ok: true, json: async () => value });
const pngResponse = () => jsonResponse({ image: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY9sAAAAASUVORK5CYII=', mimeType: 'image/png' });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function studio(options = {}) {
  const handler = options.fetchImpl;
  return browser({ ...options, saved: { [key('image-model')]: imageConfig, ...options.saved }, fetchImpl: (url, request) => {
    if (handler) return handler(url, request);
    if (url === '/api/catalog') return jsonResponse(fixtureCatalog);
    if (url === '/api/tryon') return pngResponse();
    throw new Error(`Unexpected studio request: ${url}`);
  } });
}

test('corrupt storage and invalid configuration types safely fall back to local defaults', async () => {
  const app = browser({ saved: {
    [key('model')]: ['invalid'], [key('image-model')]: 7, [key('chat-mode')]: {},
    [key('local-backend')]: 'https://external.example',
    [key('character')]: { pose: 'unknown', portraitId: 7, generatedImage: 'https://external.example/private.png' },
  }, rawSaved: { [key('chat')]: '{broken' } });
  await flush(); await app.el('#open-settings').emit('click');
  assert.equal(app.el('#chat-mode').value, 'local');
  assert.equal(app.el('#local-backend-url').value, 'http://127.0.0.1:8000');
  assert.equal(app.el('#api-key').value, '');
  assert.equal(app.stored('character')?.generatedImage, undefined);
  assert.equal(app.stored('character').poseId, 'natural');
  assert.equal(app.el('#avatar-stage-image').src.includes('external.example'), false);
});

test('out-of-range and nonnumeric timestamps cannot break saved chat rendering', async () => {
  const app = browser({ saved: { [key('chat')]: [
    { role: 'user', content: '有效内容', timestamp: 1e100 },
    { role: 'assistant', content: '仍可显示', timestamp: { bad: true } },
  ] } });
  assert.equal(app.el('#messages').children.length, 2);
  for (const row of app.el('#messages').children) assert.equal(row.children[1].children[2].textContent, '');
  await app.send('继续'); const socket = await app.ready(); reply(socket, '正常'); await flush(); assertIdle(app);
});

test('remote input rejects 4001 characters and accepts exactly 4000 before sending', async () => {
  const app = browser({ saved: { [key('model')]: cloudConfig, [key('chat-mode')]: 'remote' }, fetchImpl: url => {
    if (url === '/api/catalog') return jsonResponse({ portraits: [], outfits: [] });
    return jsonResponse({ reply: '收到' });
  } });
  await app.send('a'.repeat(4001));
  assert.equal(app.requests.some(({ url }) => url === '/api/chat'), false);
  assert.equal(app.stored('chat'), undefined);
  await app.send('a'.repeat(4000));
  assert.equal(JSON.parse(app.requests.find(({ url }) => url === '/api/chat').options.body).messages.at(-1).content.length, 4000);
  assert.equal(app.stored('chat').at(-1).content, '收到'); assertIdle(app);
});

test('remote context fits 60 KiB and truncates sent long replies while retaining full local history', async () => {
  const messages = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: '中'.repeat(i === 19 ? 9000 : 4000), timestamp: i }));
  const app = browser({ saved: { [key('model')]: cloudConfig, [key('chat-mode')]: 'remote', [key('chat')]: messages }, fetchImpl: url => {
    if (url === '/api/catalog') return jsonResponse({ portraits: [], outfits: [] });
    return jsonResponse({ reply: '长回复'.repeat(3000) });
  } });
  await app.send('新问题');
  const request = app.requests.find(({ url }) => url === '/api/chat');
  assert.ok(Buffer.byteLength(request.options.body, 'utf8') <= 60 * 1024);
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.messages.at(-1).content, '新问题');
  assert.ok(payload.messages.length < 20);
  assert.ok(payload.messages.every(message => message.content.length <= 4000));
  assert.equal(app.stored('chat').find(message => message.content.length === 9000).content, '中'.repeat(9000));
  assert.equal(app.stored('chat').at(-1).content.length, 9000);
  await app.send('再聊');
  assert.equal(app.requests.filter(({ url }) => url === '/api/chat').length, 2); assertIdle(app);
});

test('settings write failure rolls back every previously saved field', async () => {
  let failOnce = true;
  const original = { [key('model')]: cloudConfig, [key('chat-mode')]: 'remote', [key('local-backend')]: 'http://127.0.0.1:8000' };
  const app = browser({ saved: original, storageFailure: (operation, name) => {
    if (operation === 'set' && name === key('local-backend') && failOnce) { failOnce = false; throw new Error('quota'); }
  } });
  await app.el('#open-settings').emit('click');
  app.el('#api-key').value = 'changed-placeholder';
  app.el('#local-backend-url').value = 'http://127.0.0.1:8001';
  await app.el('#settings-form').emit('submit');
  for (const [name, value] of Object.entries(original)) assert.deepEqual(app.stored(name.slice('mori-companion-'.length, -3)), value);
  assert.equal(app.el('#settings-dialog').open, true);
  assert.match(app.el('#form-error').textContent, /保留原配置/);
});

test('changing chat mode cancels old remote request and ignores its late result during a newer local turn', async () => {
  const pending = deferred();
  const app = browser({ saved: { [key('model')]: cloudConfig, [key('chat-mode')]: 'remote' }, fetchImpl: url => url === '/api/catalog' ? jsonResponse({ portraits: [], outfits: [] }) : pending.promise });
  await app.send('旧云端'); const remote = app.requests.find(({ url }) => url === '/api/chat');
  await app.el('#open-settings').emit('click'); app.el('#chat-mode').value = 'local';
  await app.el('#chat-mode').emit('change'); await app.el('#settings-form').emit('submit');
  assert.equal(remote.options.signal.aborted, true);
  await app.send('新本机'); const socket = await app.ready();
  pending.resolve(jsonResponse({ reply: '不应保存' })); await flush();
  assert.equal(app.el('#message-input').disabled, true);
  assert.equal(app.stored('chat').some(message => message.content === '不应保存'), false);
  reply(socket, '新回复'); await flush(); assertIdle(app);
});

test('forgetting keys cancels active requests, removes both keys and prevents late persistence', async () => {
  const pending = deferred();
  const app = browser({ saved: { [key('model')]: cloudConfig, [key('chat-mode')]: 'remote', [key('image-model')]: imageConfig }, fetchImpl: url => url === '/api/catalog' ? jsonResponse({ portraits: [], outfits: [] }) : pending.promise });
  await app.send('等待'); const request = app.requests.find(({ url }) => url === '/api/chat');
  await app.el('#forget-key').emit('click');
  assert.equal(request.options.signal.aborted, true);
  assert.equal(app.stored('model'), undefined); assert.equal(app.stored('image-model'), undefined);
  pending.resolve(jsonResponse({ reply: '旧结果' })); await flush();
  assert.equal(app.stored('chat').some(message => message.content === '旧结果'), false); assertIdle(app);
});

test('OpenAI image default stays gpt-image-2 after provider change, blank-field save and reopening', async () => {
  const app = browser(); await app.el('#open-settings').emit('click');
  app.el('#image-provider').value = 'openai'; await app.el('#image-provider').emit('change');
  assert.equal(app.el('#image-model').value, 'gpt-image-2');
  app.el('#image-model').value = ''; app.el('#image-api-key').value = 'image-placeholder';
  await app.el('#settings-form').emit('submit');
  assert.equal(app.stored('image-model').model, 'gpt-image-2');
  await app.el('#open-settings').emit('click'); assert.equal(app.el('#image-model').value, 'gpt-image-2');
});

test('concurrent generation clicks share catalog loading and issue only one image request', async () => {
  const catalog = deferred(), generation = deferred();
  const app = studio({ fetchImpl: url => url === '/api/catalog' ? catalog.promise : generation.promise });
  const first = app.el('#generate-tryon').emit('click'), second = app.el('#generate-tryon').emit('click');
  catalog.resolve(jsonResponse(fixtureCatalog)); await flush();
  assert.equal(app.requests.filter(({ url }) => url === '/api/catalog').length, 1);
  assert.equal(app.requests.filter(({ url }) => url === '/api/tryon').length, 1);
  generation.resolve(pngResponse()); await Promise.all([first, second]);
  assert.equal(app.objectURLs.size, 1); assertIdle(app);
});

test('cancelled generation cannot overwrite a newer chat or create a preview URL', async () => {
  const pending = deferred();
  const app = studio({ fetchImpl: url => url === '/api/catalog' ? jsonResponse(fixtureCatalog) : pending.promise });
  await flush(); const generating = app.el('#generate-tryon').emit('click'); await flush();
  const request = app.requests.find(({ url }) => url === '/api/tryon');
  await app.el('#new-chat').emit('click'); assert.equal(request.options.signal.aborted, false);
  await app.send('继续聊天'); const socket = await app.ready();
  await app.el('#generate-tryon').emit('click'); assert.equal(request.options.signal.aborted, true);
  pending.resolve(pngResponse()); await generating;
  assert.equal(app.objectURLs.size, 0); assert.equal(app.el('#message-input').disabled, true);
  reply(socket, '收到'); await flush(); assertIdle(app);
});

test('changing pose aborts a portrait without locking avatar or outfit controls', async () => {
  const pending = deferred();
  const app = studio({ fetchImpl: url => url === '/api/catalog' ? jsonResponse(fixtureCatalog) : pending.promise });
  await flush(); const generating = app.el('#generate-tryon').emit('click'); await flush();
  for (const name of ['#choose-avatar', '#stage-change-avatar', '#choose-outfit', '#pose-select']) assert.equal(app.el(name).disabled, false);
  const request = app.requests.find(({ url }) => url === '/api/tryon');
  assert.equal(JSON.parse(request.options.body).pose_id, 'natural');
  app.el('#pose-select').value = 'heart'; await app.el('#pose-select').emit('change');
  assert.equal(app.el('#pose-select').value, 'heart');
  assert.equal(request.options.signal.aborted, true);
  await app.el('#choose-avatar').emit('click'); assert.equal(app.el('#picker-dialog').open, true);
  pending.resolve(pngResponse()); await generating;
  assert.equal(app.objectURLs.size, 0);
  for (const name of ['#choose-avatar', '#stage-change-avatar', '#choose-outfit', '#pose-select']) assert.equal(app.el(name).disabled, false);
});

test('malformed image responses show a recoverable error without a generated URL', async () => {
  for (const response of [jsonResponse(null), jsonResponse({ image: '*bad*', mimeType: 'image/png' }), jsonResponse({ image: 'aGVsbG8=', mimeType: 'image/svg+xml' }), { ok: true, json: async () => { throw new Error('invalid JSON'); } }]) {
    const app = studio({ fetchImpl: url => url === '/api/catalog' ? jsonResponse(fixtureCatalog) : response });
    await flush(); await app.el('#generate-tryon').emit('click');
    assert.equal(app.objectURLs.size, 0); assert.equal(app.el('#picker-dialog').open, false);
    assert.match(app.el('#portrait-status').textContent, /格式无效|有效图片/); assertIdle(app);
  }
});

test('failed preview rendering and changing pose revoke generated URLs and restore the selected portrait', async () => {
  const app = studio(); await flush(); await app.el('#generate-tryon').emit('click');
  const first = app.el('#avatar-stage-image').src;
  assert.ok(first.startsWith('blob:')); assert.equal(app.stored('character')?.generatedImage, undefined);
  await app.el('#avatar-stage-image').emit('error');
  assert.ok(app.revoked.includes(first)); assert.equal(app.el('#avatar-stage-image').src, fixtureCatalog.portraits[0].image);
  await app.el('#generate-tryon').emit('click'); const second = app.el('#avatar-stage-image').src;
  app.el('#pose-select').value = 'wave'; await app.el('#pose-select').emit('change');
  assert.ok(app.revoked.includes(second)); assert.equal(app.el('#avatar-stage-image').src, fixtureCatalog.portraits[0].image);
  assert.equal(app.stored('character').poseId, 'wave');
});

test('catalog failure can retry once and avatar/outfit filters continue working', async () => {
  let catalogs = 0;
  const app = studio({ fetchImpl: url => {
    assert.equal(url, '/api/catalog');
    if (++catalogs === 1) throw new Error('offline');
    return jsonResponse(fixtureCatalog);
  } });
  await flush(); await app.el('#choose-avatar').emit('click');
  assert.equal(catalogs, 2); assert.match(app.el('#picker-result-count').textContent, /1/);
  await app.filterGroups.get('[data-avatar-filter]')[1].emit('click');
  assert.match(app.el('#picker-grid').children[0].children[0].attributes.get('aria-label'), /面部/);
  await app.el('#choose-outfit').emit('click'); await app.filterGroups.get('[data-outfit-library]')[1].emit('click');
  assert.match(app.el('#picker-grid').children[0].children[0].attributes.get('aria-label'), /动漫/);
});

for (const [name, samples, value, hint] of [['short', 2400, 0.1, /0\.1/], ['silent', 4800, 0, /静音/]]) {
  test(`${name} microphone recording is rejected before any audio is sent`, async () => {
    const app = browser(); const starting = app.el('#mic-button').emit('click'); const socket = await app.ready(); await starting;
    app.processors[0].onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(samples).fill(value) } });
    await app.el('#mic-button').emit('click');
    assert.equal(socket.sent.length, 1); assert.equal(app.stored('chat'), undefined);
    assert.equal(app.tracks[0].stopped, true); assert.match(app.el('#local-voice-status').textContent, hint);
    assert.equal(app.el('#message-input').disabled, false);
  });
}

test('microphone permission rejection releases its startup lock and allows a text turn', async () => {
  const app = browser({ getUserMedia: async () => { throw new Error('麦克风权限被拒绝'); } });
  const starting = app.el('#mic-button').emit('click'); const socket = await app.ready(); await starting;
  assert.equal(app.el('#mic-button').disabled, false); assert.equal(app.el('#message-input').disabled, false);
  assert.equal(app.processors.length, 0); assert.match(app.el('#local-voice-status').textContent, /权限被拒绝/);
  await app.send('改用文字'); assert.equal(socket.sent.at(-1).text, '改用文字'); reply(socket, '可以'); await flush(); assertIdle(app);
});

test('same-clock turns have distinct IDs and stale old text is ignored', async () => {
  const app = browser({ now: 123456 }); await app.send('第一轮'); const socket = await app.ready();
  const oldID = socket.sent.at(-1).turn_id; reply(socket, '完成'); await flush();
  await app.send('第二轮'); const newID = socket.sent.at(-1).turn_id;
  assert.notEqual(oldID, newID);
  socket.receive({ type: 'assistant.text.delta', turn_id: oldID, text: '不应混入' });
  socket.receive({ type: 'turn.end', turn_id: oldID });
  assert.equal(app.el('#message-input').disabled, true);
  reply(socket, '新回复'); await flush();
  assert.equal(app.stored('chat').at(-1).content, '新回复'); assertIdle(app);
});

test('clearing memory stops queued audio and ignores repeated clicks while awaiting acknowledgement', async () => {
  const app = browser(); await app.send('播放'); const socket = await app.ready(); sendAudio(socket); sendAudio(socket); reply(socket, '回复'); await flush();
  const clearing = app.el('#clear-local-memory').emit('click'); await flush();
  assert.equal(app.audio[0].paused, true); assert.equal(app.revoked.length, 2);
  await app.el('#clear-local-memory').emit('click');
  assert.equal(socket.sent.filter(item => item.type === 'session.reset').length, 1);
  socket.receive({ type: 'session.reset' }); await clearing; assert.equal(app.timers.size, 0);
});

test('browser speech stops local audio and a new local turn cancels browser speech', async () => {
  const app = browser({ speech: true }); await app.send('本机回复'); const socket = await app.ready(); sendAudio(socket); reply(socket, '朗读这句话'); await flush();
  const assistant = app.el('#messages').children.at(-1);
  await assistant.children[1].children[3].children[0].emit('click');
  assert.equal(app.audio[0].paused, true); assert.equal(app.utterances.at(-1).text, '朗读这句话');
  const before = app.speechCancellations;
  await app.send('新消息'); assert.ok(app.speechCancellations > before);
  reply(socket, '完成'); await flush(); assertIdle(app);
});

test('studio generation button exposes cancellation without returning to chat', async () => {
  const pending = deferred();
  const app = studio({ fetchImpl: url => url === '/api/catalog' ? jsonResponse(fixtureCatalog) : pending.promise });
  await flush();
  const generating = app.el('#generate-tryon').emit('click'); await flush();
  assert.equal(app.el('#generate-tryon').disabled, false);
  assert.match(app.el('#generate-tryon').textContent, /取消/);
  const request = app.requests.find(({ url }) => url === '/api/tryon');
  await app.el('#generate-tryon').emit('click');
  assert.equal(request.options.signal.aborted, true); assertIdle(app);
  pending.resolve(pngResponse()); await generating;
  assert.equal(app.objectURLs.size, 0);
});

function lastError(app) { return app.el('#messages').children.at(-1)?.children[1]?.children[1]?.textContent || ''; }
async function record(app, samples = 4800, provider = 'local') {
  const starting = app.el('#mic-button').emit('click');
  const socket = app.sockets.at(-1)?.readyState === 1 ? app.sockets.at(-1) : await app.ready(app.sockets.at(-1), provider);
  await starting;
  app.processors.at(-1).onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(samples).fill(0.1) } });
  await app.el('#mic-button').emit('click');
  return socket;
}

test('batch2 malformed scalar and array WebSocket controls are ignored without ending a valid turn', async () => {
  const app = browser(); await app.send('继续'); const socket = await app.ready();
  for (const value of [null, [], 7, 'bad', true]) assert.doesNotThrow(() => socket.receive(value));
  assert.equal(app.el('#message-input').disabled, true);
  reply(socket, '有效'); await flush(); assert.equal(app.stored('chat').at(-1).content, '有效'); assertIdle(app);
});

test('batch2 local text rejects invalid delta types and cumulative replies above 20000', async () => {
  for (const invalid of [{ bad: true }, 7, null, 'a'.repeat(20001)]) {
    const app = browser(); await app.send('测试'); const socket = await app.ready();
    socket.receive({ type: 'assistant.text.delta', text: invalid }); await flush();
    assert.match(lastError(app), /格式无效|长度限制/); assertIdle(app); assert.equal(app.timers.size, 0);
    assert.equal(socket.sent.at(-1).type, 'assistant.cancel');
  }
  const app = browser(); await app.send('边界'); const socket = await app.ready();
  socket.receive({ type: 'assistant.text.delta', text: 'a'.repeat(20000) }); socket.receive({ type: 'turn.end' }); await flush();
  assert.equal(app.stored('chat').at(-1).content.length, 20000);
  const excessive = browser(); await excessive.send('累计'); const overSocket = await excessive.ready();
  overSocket.receive({ type: 'assistant.text.delta', text: 'a'.repeat(10000) });
  overSocket.receive({ type: 'assistant.text.delta', text: 'b'.repeat(10001) }); await flush();
  assert.match(lastError(excessive), /长度限制/); assert.equal(excessive.stored('chat').length, 1); assertIdle(excessive);
  for (const text of [null, '', '你'.repeat(2001)]) {
    const voice = browser(); const connection = await record(voice);
    connection.receive({ type: 'asr.final', text }); await flush();
    assert.match(lastError(voice), /识别结果无效/); assert.equal(voice.stored('chat'), undefined); assertIdle(voice);
  }
});

test('batch2 binary audio requires a segment and overlapping segments fail immediately', async () => {
  for (const overlap of [false, true]) {
    const app = browser(); await app.send('音频边界'); const socket = await app.ready();
    if (overlap) { socket.receive({ type: 'assistant.audio.start' }); socket.receive({ type: 'assistant.audio.start' }); }
    else socket.receiveAudio(new ArrayBuffer(48));
    await flush(); assert.match(lastError(app), /分段格式无效|分段重叠/);
    assertIdle(app); assert.equal(app.objectURLs.size, 0); assert.equal(app.timers.size, 0);
  }
});

test('batch2 empty ended segments and unfinished segments at turn.end cannot succeed', async () => {
  for (const scenario of ['missing-start', 'empty', 'unfinished']) {
    const app = browser(); await app.send('分段结束'); const socket = await app.ready();
    socket.receive({ type: 'assistant.text.delta', text: '不能提交' });
    if (scenario !== 'missing-start') socket.receive({ type: 'assistant.audio.start' });
    socket.receive({ type: scenario === 'unfinished' ? 'turn.end' : 'assistant.audio.end' });
    await flush(); assert.match(lastError(app), /分段不完整|未完整传输/);
    assert.equal(app.stored('chat').length, 1); assertIdle(app); assert.equal(app.timers.size, 0);
  }
});

test('batch2 server cancellation immediately releases a waiting turn without turn.end', async () => {
  const app = browser(); await app.send('服务取消'); const socket = await app.ready();
  socket.receive({ type: 'assistant.cancel' }); await flush();
  assert.match(lastError(app), /已取消/); assertIdle(app); assert.equal(app.timers.size, 0);
  reply(socket, '迟到'); await flush(); assert.equal(app.stored('chat').length, 1);
});

test('batch2 reset timeout discards the old connection and next message reconnects', async () => {
  const app = browser(); const clearing = app.el('#clear-local-memory').emit('click'); const socket = await app.ready();
  await app.expire(10000); await clearing;
  assert.equal(socket.readyState, 3); assert.equal(app.el('#clear-local-memory').disabled, false);
  assert.match(app.el('#local-voice-status').textContent, /旧连接已断开/);
  await app.send('空白新会话'); const fresh = await app.ready(); assert.notEqual(fresh, socket);
  reply(fresh, '恢复'); await flush(); assertIdle(app);
});

test('batch2 microphone cannot start while memory reset acknowledgement is pending', async () => {
  const app = browser(); const clearing = app.el('#clear-local-memory').emit('click'); const socket = await app.ready();
  await app.el('#mic-button').emit('click');
  assert.equal(app.micRequests, 0); assert.equal(app.processors.length, 0);
  socket.receive({ type: 'session.reset' }); await clearing; assert.equal(app.timers.size, 0);
});

test('batch2 recording connection loss immediately stops tracks and recorder timer', async () => {
  const app = browser(); const starting = app.el('#mic-button').emit('click'); const socket = await app.ready(); await starting;
  assert.equal(app.tracks[0].stopped, false); socket.close(); await flush();
  assert.equal(app.tracks[0].stopped, true); assert.equal(app.contexts[0].state, 'closed');
  assert.equal(app.processors[0].onaudioprocess, null); assert.equal(app.timers.size, 0);
  assert.equal(app.el('#message-input').disabled, false); assert.equal(app.el('#mic-button').textContent, '语音');
});

test('batch2 audio context initialization failures release acquired tracks and leave text usable', async () => {
  for (const phase of ['constructor', 'resume']) {
    const app = browser({ audioFailure: step => { if (step === phase) throw new Error('设备初始化失败'); } });
    const starting = app.el('#mic-button').emit('click'); const socket = await app.ready(); await starting;
    assert.equal(app.tracks[0].stopped, true); assert.equal(app.processors.length, 0);
    assert.equal(app.el('#mic-button').disabled, false); assert.match(app.el('#local-voice-status').textContent, /设备初始化失败/);
    if (phase === 'resume') assert.equal(app.contexts[0].state, 'closed');
    await app.send('继续文字'); reply(socket, '收到'); await flush(); assertIdle(app);
  }
});

function savedReply() { return { [key('chat')]: [{ role: 'assistant', content: '历史朗读', timestamp: 1 }] }; }
function readButton(app) { return app.el('#messages').children[0].children[1].children[3].children[0]; }

test('batch2 historical speech is refused while microphone recording is active', async () => {
  const app = browser({ saved: savedReply(), speech: true });
  const starting = app.el('#mic-button').emit('click'); const socket = await app.ready(); await starting;
  await readButton(app).emit('click'); assert.equal(app.utterances.length, 0);
  assert.match(app.el('#local-voice-status').textContent, /结束(?:通话或)?录音/);
  await app.el('#interrupt-local-voice').emit('click'); assert.equal(app.tracks[0].stopped, true); assert.equal(socket.sent.length, 1);
});

test('batch2 stale utterance callbacks cannot alter current speech and incoming WAV waits for it', async () => {
  const app = browser({ saved: savedReply(), speech: true });
  await readButton(app).emit('click'); const old = app.utterances[0];
  await readButton(app).emit('click'); const current = app.utterances[1];
  current.onstart(); old.onend(); old.onerror();
  assert.equal(app.el('#avatar-stage').classList.contains('is-speaking'), true);
  await app.send('等待音频'); const socket = await app.ready();
  await readButton(app).emit('click'); const speaking = app.utterances.at(-1); speaking.onstart();
  sendAudio(socket); assert.equal(app.audio.length, 0);
  speaking.onend(); sendAudio(socket); assert.equal(app.audio.length, 1);
  reply(socket, '完成'); await flush(); assertIdle(app);
});

test('batch2 first pending voice hides welcome without creating exportable history', async () => {
  const app = browser(); const socket = await record(app);
  assert.equal(app.el('#welcome').hidden, true); assert.equal(app.el('#export-chat').disabled, true);
  assert.equal(app.stored('chat'), undefined);
  socket.receive({ type: 'asr.final', text: '真实转写' }); reply(socket, '完成'); await flush();
  assert.equal(app.el('#export-chat').disabled, false); assert.equal(app.stored('chat')[0].content, '真实转写');
});

test('batch2 null remote JSON produces readable model failure instead of property access error', async () => {
  for (const ok of [true, false]) {
    const app = browser({ saved: { [key('model')]: cloudConfig, [key('chat-mode')]: 'remote' }, fetchImpl: url => url === '/api/catalog' ? jsonResponse({ portraits: [], outfits: [] }) : { ok, json: async () => null } });
    await app.send('云端异常'); assert.match(lastError(app), /没有返回文字回复|模型请求失败/);
    assert.equal(lastError(app).includes('Cannot read'), false); assertIdle(app);
  }
});

test('batch2 blank saved messages are filtered from remote context and full history metadata is projected', async () => {
  const saved = [
    { role: 'user', content: '   ', timestamp: 1 },
    { role: 'assistant', content: '历史', timestamp: 2, error: true, pending: true, retryable: false, apiKey: 'never-retain' },
  ];
  const app = browser({ saved: { [key('model')]: cloudConfig, [key('chat-mode')]: 'remote', [key('chat')]: saved }, fetchImpl: url => url === '/api/catalog' ? jsonResponse({ portraits: [], outfits: [] }) : jsonResponse({ reply: '新回复' }) });
  assert.equal(app.el('#messages').children.length, 1);
  assert.equal(app.el('#messages').children[0].className.includes('error'), false);
  await app.send('新问题');
  const sent = JSON.parse(app.requests.find(item => item.url === '/api/chat').options.body);
  assert.ok(sent.messages.every(message => message.content.trim()));
  assert.deepEqual(app.stored('chat')[0], { role: 'assistant', content: '历史', timestamp: 2 });
});

test('batch2 failed chat clearing keeps on-screen and persisted history intact', async () => {
  const app = browser({ saved: savedReply(), storageFailure: (operation, name) => { if (operation === 'set' && name === key('chat')) throw new Error('quota'); } });
  await app.el('#clear-chat').emit('click');
  assert.equal(app.el('#messages').children.length, 1); assert.equal(app.stored('chat')[0].content, '历史朗读');
  assert.match(app.el('#local-voice-status').textContent, /保存|存储/);
});

test('batch2 failed export still revokes its blob and names the file using local date', async () => {
  class LocalDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-01-01T23:00:00Z'])); }
    getFullYear() { return 2026; } getMonth() { return 0; } getDate() { return 2; }
  }
  const app = browser({ saved: savedReply(), dateClass: LocalDate, clickFailure: tag => { if (tag === 'a') throw new Error('download blocked'); } });
  await app.el('#export-chat').emit('click');
  const link = app.created.find(item => item.tag === 'a'); assert.equal(link.download, 'zhixia-chat-2026-01-02.txt');
  assert.match(app.el('#local-voice-status').textContent, /导出记录/);
  await app.expire(1000); assert.deepEqual(app.revoked, [link.href]);
});

test('batch2 failed voice preference write preserves playback and pressed state', async () => {
  const app = browser({ storageFailure: (operation, name) => { if (operation === 'set' && name === key('voice')) throw new Error('quota'); } });
  await app.send('播放'); const socket = await app.ready(); sendAudio(socket);
  await app.el('#voice-toggle').emit('click');
  assert.equal(app.el('#voice-toggle').attributes.get('aria-pressed'), 'true'); assert.equal(app.audio[0].paused, false);
  assert.equal(app.stored('voice'), undefined); reply(socket, '完成'); await flush(); assertIdle(app);
});

test('batch2 empty image key removes saved image credentials when settings are saved', async () => {
  const app = studio(); await flush(); await app.el('#open-settings').emit('click');
  app.el('#image-api-key').value = ''; await app.el('#settings-form').emit('submit');
  assert.equal(app.stored('image-model'), undefined);
  await app.el('#open-settings').emit('click'); assert.equal(app.el('#image-api-key').value, '');
});

test('batch2 counts follow local Unicode versus remote units and stop remains clickable after input updates', async () => {
  const app = browser(); app.el('#message-input').value = '🙂🙂'; await app.el('#message-input').emit('input');
  assert.equal(app.el('#character-count').textContent, '2 / 2000');
  app.el('#message-input').value = '你'.repeat(2001); await app.el('#message-input').emit('input');
  assert.equal(app.el('#message-input').attributes.get('aria-invalid'), 'true');
  await app.send('有效'); const socket = await app.ready();
  assert.equal(app.el('#message-input').style.height, 'auto');
  await app.el('#message-input').emit('input'); assert.equal(app.el('#send-button').disabled, false);
  await app.el('#composer-form').emit('submit'); assert.equal(socket.sent.at(-1).type, 'assistant.cancel'); assertIdle(app);
  const remote = browser({ saved: { [key('model')]: cloudConfig, [key('chat-mode')]: 'remote' } }); remote.el('#message-input').value = '🙂🙂'; await remote.el('#message-input').emit('input');
  assert.equal(remote.el('#character-count').textContent, '4 / 4000');
});

const seedProvider = 'seeduplex';
const seedKey = { apiKey: 'mock-doubao-voice-key' };
const seedMode = { [key('chat-mode')]: seedProvider };

async function selectEngine(app, provider, apiKey) {
  await app.el('#open-settings').emit('click');
  app.el('#chat-mode').value = provider;
  await app.el('#chat-mode').emit('change');
  if (apiKey !== undefined) app.el('#seeduplex-api-key').value = apiKey;
  await app.el('#settings-form').emit('submit');
}

function assertSeedIdle(app) {
  assert.equal(app.el('#mic-button').disabled, false);
  assert.equal(app.el('#message-input').disabled, true);
  assert.equal(app.el('#send-button').disabled, true);
  assert.equal(app.el('#typing-indicator').hidden, true);
}

function seedReply(socket, text) {
  const { turn_id } = socket.sent.at(-1);
  socket.receive({ type: 'asr.final', text: '今天很开心', turn_id });
  socket.receive({ type: 'assistant.audio.start', turn_id });
  socket.receiveAudio(new ArrayBuffer(48));
  socket.receive({ type: 'assistant.audio.end', turn_id });
  reply(socket, text);
}

test('Doubao settings need no cloud chat key and recording sends the voice key only in the WebSocket start frame', async () => {
  const app = browser();
  await selectEngine(app, seedProvider, seedKey.apiKey);
  assert.equal(app.el('#settings-dialog').open, false);
  assert.equal(app.el('#api-key').required, false);
  assert.equal(app.el('#seeduplex-fields').hidden, false);
  assert.equal(app.el('#remote-chat-fields').hidden, true);
  assert.equal(app.stored('model'), undefined);
  assert.equal(app.stored(seedProvider), undefined);
  assertSeedIdle(app);
  await app.send('不要发文字');
  assert.equal(app.sockets.length, 0);
  assert.equal(app.stored('chat'), undefined);

  const socket = await record(app, 4800, seedProvider);
  assert.deepEqual(socket.sent[0], { type: 'session.start', provider: seedProvider, input_rate: 16000, codec: 'pcm_s16le', api_key: seedKey.apiKey,
    character_id: 'zhixia', persona_id: 'zhixia', voice_id: 'zhixia' });
  assert.equal(new URL(socket.url).origin, 'ws://localhost:3000');
  assert.equal(socket.url.includes(seedKey.apiKey), false);
  assert.equal(socket.sent[1].byteLength, 3200);
  assert.equal(socket.sent[2].type, 'input.end');
  assert.ok(socket.sent[2].turn_id);
  assert.equal(app.tracks[0].stopped, true);
  assert.equal(app.el('#send-button').disabled, false);
  assert.ok(app.requests.every(({ url }) => url === '/api/catalog'));
  seedReply(socket, '我也为你开心'); await flush();
  assert.deepEqual(app.stored('chat').map(({ content }) => content), ['今天很开心', '我也为你开心']);
  assert.equal(app.objectURLs.get(app.audio[0].src).type, 'audio/wav');
  assert.equal(JSON.stringify(app.stored('chat')).includes(seedKey.apiKey), false);
  assertSeedIdle(app);
});

test('empty Doubao key defers permission to the backend and a missing-key error never opens the microphone', async () => {
  const app = browser();
  await selectEngine(app, seedProvider, '');
  assert.equal(app.el('#settings-dialog').open, false);
  assert.equal(app.stored(seedProvider), undefined);
  const starting = app.el('#mic-button').emit('click');
  const rejected = app.sockets[0]; rejected.open();
  assert.equal(rejected.sent[0].provider, seedProvider);
  assert.equal('api_key' in rejected.sent[0], false);
  assert.equal(app.micRequests, 0);
  rejected.receive({ type: 'error', message: '请配置 SEEDUPLEX_API_KEY' });
  await starting;
  assert.match(app.el('#local-voice-status').textContent, /SEEDUPLEX_API_KEY/);
  assert.doesNotMatch(app.el('#connection-label').textContent, /已连接/);
  rejected.onclose(); await flush();
  assert.match(app.el('#local-voice-status').textContent, /SEEDUPLEX_API_KEY/);
  assert.equal(app.micRequests, 0);
  assert.equal(rejected.readyState, 3);
  assertSeedIdle(app);

  const accepted = await record(app, 4800, seedProvider);
  assert.notEqual(accepted, rejected);
  assert.equal('api_key' in accepted.sent[0], false);
  seedReply(accepted, '已通过后端配置连接'); await flush();
  assert.match(app.el('#connection-label').textContent, /已连接/);
  assertSeedIdle(app);
});

test('Doubao cancel clears pending audio and a new session retains browser history', async () => {
  const app = browser({ saved: seedMode });
  await selectEngine(app, seedProvider, seedKey.apiKey);
  const first = await record(app, 4800, seedProvider);
  const canceledTurn = first.sent.at(-1).turn_id;
  await app.el('#interrupt-local-voice').emit('click');
  assert.equal(first.sent.at(-1).type, 'assistant.cancel');
  assert.equal(app.stored('chat'), undefined);
  assertSeedIdle(app);
  const next = await record(app, 4800, seedProvider);
  assert.notEqual(next.sent.at(-1).turn_id, canceledTurn);
  first.receive({ type: 'assistant.text.delta', turn_id: canceledTurn, text: '迟到的已取消回复' });
  first.receive({ type: 'turn.end', turn_id: canceledTurn });
  seedReply(next, '新轮回复'); await flush();
  assert.deepEqual(app.stored('chat').map(({ content }) => content), ['今天很开心', '新轮回复']);
  await app.el('#clear-local-memory').emit('click');
  assert.equal(next.readyState, 3);
  assert.equal(next.sent.some(({ type }) => type === 'session.reset'), false);
  assert.equal(app.stored('chat').at(-1).content, '新轮回复');
  const fresh = await record(app, 4800, seedProvider);
  assert.notEqual(fresh, next);
  seedReply(fresh, '新会话回复'); await flush(); assertSeedIdle(app);
});

test('switching engines closes the old socket and keeps the Doubao key out of local voice', async () => {
  const app = browser({ saved: seedMode });
  await selectEngine(app, seedProvider, seedKey.apiKey);
  const seed = await record(app, 4800, seedProvider);
  await selectEngine(app, 'local');
  assert.equal(seed.readyState, 3);
  assert.equal(app.el('#seeduplex-fields').hidden, true);
  assert.equal(app.el('#message-input').disabled, false);
  assert.equal(app.stored(seedProvider), undefined);
  await app.send('本机文字'); const local = await app.ready();
  assert.equal('api_key' in local.sent[0], false);
  assert.equal(local.sent[1].type, 'text.input');
  reply(local, '本机回复'); await flush(); assertIdle(app);
  await selectEngine(app, seedProvider);
  assert.equal(local.readyState, 3);
  const fresh = await record(app, 4800, seedProvider);
  assert.equal(fresh.sent[0].api_key, seedKey.apiKey);
  seedReply(fresh, '豆包回复'); await flush(); assertSeedIdle(app);
});

test('legacy persisted Doubao keys are removed and replacements remain memory-only', async () => {
  const app = browser({ saved: { [key('chat-mode')]: 'local', [key(seedProvider)]: seedKey } });
  assert.equal(app.stored(seedProvider), undefined);
  await selectEngine(app, seedProvider, 'replacement-key');
  assert.equal(app.stored('chat-mode'), seedProvider);
  assert.equal(app.stored(seedProvider), undefined);
  const socket = await record(app, 4800, seedProvider);
  assert.equal(socket.sent[0].api_key, 'replacement-key');
  seedReply(socket, '内存配置正常'); await flush(); assertSeedIdle(app);
});

test('failed legacy Doubao key cleanup is visible and never reloads the key', async () => {
  const app = browser({
    saved: { [key(seedProvider)]: seedKey },
    storageFailure: (operation, name) => {
      if (operation === 'remove' && name === key(seedProvider)) throw new Error('blocked');
    },
  });
  await app.el('#open-settings').emit('click');
  assert.equal(app.el('#seeduplex-api-key').value, '');
  assert.match(app.el('#form-error').textContent, /无法自动清除/);
  assert.deepEqual(app.stored(seedProvider), seedKey);
});

test('forgetting keys closes Doubao and clears persistent plus memory-only credentials', async () => {
  const app = browser({ saved: { ...seedMode, [key('model')]: cloudConfig, [key('image-model')]: imageConfig } });
  await selectEngine(app, seedProvider, seedKey.apiKey);
  const socket = await record(app, 4800, seedProvider);
  await app.el('#open-settings').emit('click');
  await app.el('#forget-key').emit('click');
  assert.equal(socket.readyState, 3);
  for (const name of [seedProvider, 'model', 'image-model']) assert.equal(app.stored(name), undefined);
  assert.equal(app.el('#seeduplex-api-key').value, '');
  assertSeedIdle(app);
});


test('character switching isolates stored history and restarts the voice session with the fixed profile', async () => {
  const app = studio(); await flush();
  await app.send('和知夏对话'); const previous = await app.ready(); reply(previous, '知夏专属'); await flush();
  await app.send('切换到林溪');
  assert.equal(previous.readyState, 3);
  assert.equal(app.el('#studio-character-name').textContent, '林溪');
  assert.equal(app.el('#messages').children.length, 0);
  assert.equal(app.stored('character').poseId, 'wave');
  assert.equal(app.stored('character').outfitLibrary, 'anime');
  await app.send('和林溪对话'); const next = await app.ready();
  assert.deepEqual([next.sent[0].character_id, next.sent[0].persona_id, next.sent[0].voice_id], ['linxi', 'linxi', 'linxi']);
  reply(next, '林溪专属'); await flush();
  app.el('#character-select').value = 'zhixia'; await app.el('#character-select').emit('change');
  assert.equal(next.readyState, 3);
  assert.equal(app.el('#messages').children.length, 2);
  assert.equal(app.stored('chat').at(-1).content, '知夏专属');
});

async function startDuplex(app) {
  await app.el('#duplex-button').emit('click');
  const socket = app.sockets.at(-1);
  assert.ok(socket);
  socket.open();
  assert.equal(socket.sent[0].streaming, true);
  assert.equal(app.worklets.length, 0, 'capability confirmation precedes microphone capture');
  const { character_id, persona_id, voice_id } = socket.sent[0];
  socket.receive({ type: 'session.ready', streaming: true, input_rate: 16000, output_rate: 24000, character_id, persona_id, voice_id });
  await flush();
  assert.equal(app.worklets.length, 1);
  return socket;
}

test('studio duplex uses the real session for captions, cancellation and page lifecycle', async () => {
  const app = browser({ worklet: true, saved: seedMode });
  await selectEngine(app, seedProvider, seedKey.apiKey);
  assert.equal(app.el('#duplex-button').disabled, false);
  const socket = await startDuplex(app);
  assert.equal(new URL(socket.url).pathname, '/api/local-voice');
  assert.equal(new URL(socket.url).origin, 'ws://localhost:3000');
  assert.equal(socket.sent[0].api_key, seedKey.apiKey);
  assert.ok(!socket.url.includes(seedKey.apiKey));
  assert.equal(app.el('#duplex-button').textContent, '结束通话');
  assert.equal(app.el('#mic-button').hidden, true);
  const capture = app.worklets[0];
  capture.capture(); capture.capture();
  assert.deepEqual(socket.sent.slice(1).map(frame => frame.byteLength), [640, 640]);
  assert.equal(app.processors.length, 0);
  const first = { turn_id: 'first' };
  socket.receive({ type: 'input.speech.started', ...first });
  socket.receive({ type: 'asr.delta', text: '你', ...first });
  socket.receive({ type: 'asr.delta', text: '好', ...first });
  assert.equal(app.el('#duplex-captions').textContent, '我：你好');
  socket.receive({ type: 'asr.final', text: '你好。', ...first });
  socket.receive({ type: 'input.speech.stopped', ...first });
  socket.receive({ type: 'assistant.text.delta', text: '正在回复', ...first });
  assert.match(app.el('#duplex-captions').textContent, /知夏：正在回复/);
  socket.receive({ type: 'assistant.audio.start', sample_rate: 24000, codec: 'pcm_s16le', channels: 1, ...first });
  socket.receiveAudio(new ArrayBuffer(960));
  const player = app.contexts[0].players[0];
  await app.el('#interrupt-local-voice').emit('click');
  assert.equal(player.stopped, true);
  assert.deepEqual(socket.sent.at(-1), { type: 'assistant.cancel', ...first });
  assert.equal(app.tracks[0].stopped, false);
  socket.receive({ type: 'assistant.text.final', text: '迟到回复', ...first });
  socket.receive({ type: 'turn.end', ...first });
  const second = { turn_id: 'second' };
  socket.receive({ type: 'input.speech.started', ...second });
  socket.receive({ type: 'asr.final', text: '第二轮', ...second });
  socket.receive({ type: 'assistant.text.final', text: '仍然在线', ...second });
  socket.receive({ type: 'turn.end', ...second });
  assert.deepEqual(app.stored('chat').map(entry => entry.content), ['你好。', '第二轮', '仍然在线']);
  assert.equal(app.sockets.length, 1);
  await app.hide();
  assert.equal(socket.readyState, 3);
  assert.equal(socket.sent.at(-1).type, 'session.stop');
  assert.equal(app.tracks[0].stopped, true);
  assert.equal(capture.closed && capture.disconnected, true);
  assert.equal(app.contexts[0].state, 'closed');
  assert.equal(app.el('#duplex-button').textContent, '开始通话');
  assert.equal(app.el('#mic-button').hidden, false);
  assert.equal(app.timers.size, 0);
});

test('studio offers manual recording on browsers without AudioWorklet', async () => {
  const app = browser({ saved: seedMode });
  assert.equal(app.el('#duplex-button').hidden, false);
  assert.equal(app.el('#duplex-button').disabled, true);
  assert.match(app.el('#duplex-hint').textContent, /不支持免提通话.*按轮语音/);
  await app.el('#duplex-button').emit('click');
  assert.equal(app.sockets.length, 0);
  assert.equal(app.micRequests, 0);
  const socket = await record(app, 4800, seedProvider);
  assert.equal(socket.sent[0].streaming, undefined);
  assert.equal(socket.sent.at(-1).type, 'input.end');
  await app.pagehide();
  assert.equal(socket.readyState, 3);
});

test('local studio serves shared modules, resolves pose_id, and forwards only allowlisted personas', async (t) => {
  const sent = [];
  const server = createAppServer({ fetchImpl: async (_url, options) => {
    const payload = JSON.parse(options.body);
    sent.push(payload);
    if (payload.messages) return Response.json({ choices: [{ message: { content: '林溪回复' } }] });
    const { image, mimeType } = await pngResponse().json();
    return Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: image, mimeType } }] } }] });
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const module = await fetch(`${base}/character-state.mjs`);
  assert.equal(module.status, 200);
  assert.match(module.headers.get('content-type'), /javascript/);
  assert.match(await module.text(), /export const CHARACTERS/);
  for (const [path, content] of [['duplex-session.mjs', /export function createDuplexSession/], ['duplex-capture.worklet.js', /registerProcessor\('pcm-capture'/]]) {
    const response = await fetch(`${base}/${path}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript/);
    assert.match(await response.text(), content);
  }
  const face = { imageConfig: { ...imageConfig, provider: 'gemini' }, portraitId: 'f000a1c4200', outfitId: 'SPR-0001', library: 'real' };
  assert.equal((await post('/api/tryon', { ...face, pose_id: 'https://example.invalid/pose' })).status, 400);
  assert.equal((await post('/api/tryon', { ...face, pose_id: 'heart', pose: 'wave' })).status, 400);
  assert.equal(sent.length, 0);
  const portrait = await post('/api/tryon', { ...face, pose_id: 'heart' });
  assert.equal(portrait.status, 200);
  assert.equal((await portrait.json()).pose, 'heart');
  assert.match(sent[0].contents[0].parts[0].text, /forming a small heart/);
  const chat = { ...cloudConfig, messages: [{ role: 'user', content: '你好' }] };
  assert.equal((await post('/api/chat', { ...chat, characterId: 'custom' })).status, 400);
  assert.equal((await post('/api/chat', { ...chat, characterId: 'linxi' })).status, 200);
  assert.equal(sent.length, 2);
  assert.match(sent[1].messages[0].content, /你叫林溪/);
});
