import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import { createDuplexSession, supportsDuplex } from './duplex-session.mjs';

const profile = { characterId: 'zhixia', personaId: 'zhixia', voiceId: 'zhixia' };
const url = 'ws://localhost:3000/api/local-voice';
const ready = { type: 'session.ready', streaming: true, codec: 'pcm_s16le', channels: 1, input_rate: 16000, output_rate: 24000,
  character_id: 'zhixia', persona_id: 'zhixia', voice_id: 'zhixia' };
const flush = () => new Promise(resolve => setImmediate(resolve));

function browser(t, { getMedia } = {}) {
  const sockets = [], contexts = [], tracks = [], worklets = [], mediaRequests = [], states = [], events = [], levels = [];
  const timers = new Map();
  let timerId = 0;
  class Socket {
    static OPEN = 1;
    constructor(address) {
      this.url = address;
      this.readyState = 0;
      this.bufferedAmount = 0;
      this.sent = [];
      sockets.push(this);
    }
    send(data) {
      assert.equal(this.readyState, Socket.OPEN);
      this.sent.push(typeof data === 'string' ? JSON.parse(data) : data);
    }
    open() { this.readyState = Socket.OPEN; this.onopen?.(); }
    receive(data) { this.onmessage?.({ data: data instanceof ArrayBuffer ? data : JSON.stringify(data) }); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  class AudioNode {
    connect(destination) { this.destination = destination; }
    disconnect() { this.destination = null; }
  }
  class Context {
    constructor() {
      this.state = 'suspended';
      this.currentTime = 5;
      this.destination = {};
      this.moduleURLs = [];
      this.live = new Set();
      this.scheduled = [];
      contexts.push(this);
    }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    get audioWorklet() { return { addModule: async (path) => { this.moduleURLs.push(path); } }; }
    createMediaStreamSource() { return (this.source = new AudioNode()); }
    createGain() { return (this.mute = Object.assign(new AudioNode(), { gain: { value: 1 } })); }
    createBuffer(channels, length, sampleRate) {
      assert.equal(channels, 1); assert.equal(sampleRate, 24000);
      const data = new Float32Array(length);
      return { data, duration: length / sampleRate, getChannelData(channel) { assert.equal(channel, 0); return data; } };
    }
    createBufferSource() {
      const context = this;
      return Object.assign(new AudioNode(), {
        start(time) {
          assert.ok(this.destination);
          this.time = time;
          context.live.add(this);
          context.scheduled.push(this);
        },
        stop() { this.stopped = true; context.live.delete(this); },
        end() {
          context.currentTime = Math.max(context.currentTime, this.time + this.buffer.duration);
          context.live.delete(this);
          this.onended?.();
        },
      });
    }
  }
  class Worklet extends AudioNode {
    constructor(context, name) {
      super();
      this.context = context;
      this.name = name;
      this.port = { onmessage: null, close() { this.closed = true; } };
      worklets.push(this);
    }
    emit(rms = 0, pcm = new ArrayBuffer(640)) { this.port.onmessage?.({ data: { pcm, rms, peak: rms } }); }
  }
  function grant() {
    const track = { stops: 0, stop() { this.stops++; } };
    tracks.push(track);
    return { getTracks: () => [track] };
  }
  const environment = {
    AudioContext: Context, AudioWorkletNode: Worklet, WebSocket: Socket,
    location: new URL('http://localhost:3000/'),
    navigator: { mediaDevices: { async getUserMedia(options) { mediaRequests.push(options); return getMedia ? getMedia(grant) : grant(); } } },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const session = createDuplexSession({ environment, onState: state => states.push(state), onEvent: event => events.push(event), onLevel: level => levels.push(level) });
  t.after(() => session.stop());
  async function open(options = {}, receipt = ready) {
    assert.equal(await session.start({ url, profile, ...options }), true);
    const socket = sockets.at(-1);
    socket.open();
    if (receipt) socket.receive(receipt);
    await flush();
    return socket;
  }
  return { session, environment, sockets, contexts, tracks, worklets, mediaRequests, states, events, levels, timers, open };
}

const controls = (socket, type) => socket.sent.filter(item => item.type === type);
const speech = (socket, turn_id) => {
  socket.receive({ type: 'input.speech.started', turn_id });
  socket.receive({ type: 'input.speech.stopped', turn_id });
};
const audioStart = (socket, turn_id) => socket.receive({ type: 'assistant.audio.start', turn_id, sample_rate: 24000, codec: 'pcm_s16le', channels: 1 });
function pcm(value) {
  const data = new ArrayBuffer(960);
  new DataView(data).setInt16(0, value, true);
  return data;
}

test('negotiates capabilities and starts continuous 640-byte frames only after ready', async (t) => {
  const b = browser(t);
  assert.equal(supportsDuplex(b.environment), true);
  const socket = await b.open({ apiKey: 'test-voice-key' }, null);
  assert.deepEqual(socket.sent[0], { type: 'session.start', provider: 'seeduplex', codec: 'pcm_s16le', input_rate: 16000, output_rate: 24000,
    streaming: true, client_vad: true, character_id: 'zhixia', persona_id: 'zhixia', voice_id: 'zhixia', api_key: 'test-voice-key' });
  assert.equal(socket.binaryType, 'arraybuffer');
  assert.equal(b.mediaRequests.length, 0);
  assert.equal(b.timers.size, 1);
  socket.receive(ready); socket.receive(ready); await flush();
  assert.deepEqual(b.mediaRequests, [{ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }]);
  assert.equal(b.timers.size, 0);
  assert.deepEqual(b.contexts[0].moduleURLs, ['/duplex-capture.worklet.js']);
  assert.equal(b.worklets[0].name, 'pcm-capture');
  assert.equal(b.contexts[0].mute.gain.value, 0);
  const packets = Array.from({ length: 6 }, () => new ArrayBuffer(640));
  b.worklets[0].emit(0, new ArrayBuffer(638));
  packets.forEach(packet => b.worklets[0].emit(0, packet));
  assert.deepEqual(socket.sent.slice(1), packets);
  assert.equal(controls(socket, 'input.end').length, 0);
  assert.ok(!socket.url.includes('test-voice-key'));
  assert.ok(!JSON.stringify(b.states).includes('test-voice-key'));
});

test('assembles incremental captions and schedules PCM in order until the audio queue drains', async (t) => {
  const b = browser(t);
  const socket = await b.open();
  speech(socket, 'one');
  socket.receive({ type: 'asr.delta', turn_id: 'one', text: '早' });
  socket.receive({ type: 'asr.delta', turn_id: 'one', text: '安' });
  socket.receive({ type: 'asr.final', turn_id: 'one', text: '早安。' });
  socket.receive({ type: 'assistant.text.delta', turn_id: 'one', text: '早上' });
  socket.receive({ type: 'assistant.text.delta', turn_id: 'one', text: '好' });
  socket.receive({ type: 'assistant.text.final', turn_id: 'one', text: '早上好！' });
  audioStart(socket, 'one');
  socket.receive(pcm(16384)); socket.receive(pcm(-16384));
  socket.receive({ type: 'assistant.audio.end', turn_id: 'one' });
  socket.receive({ type: 'turn.end', turn_id: 'one' });
  audioStart(socket, 'one'); socket.receive(pcm(32767));
  const [first, second] = b.contexts[0].scheduled;
  assert.equal(b.contexts[0].scheduled.length, 2);
  assert.deepEqual([first.buffer.data[0], second.buffer.data[0]], [0.5, -0.5]);
  assert.equal(first.time, 5.08);
  assert.equal(second.time, first.time + first.buffer.duration);
  assert.equal(b.session.state, 'playing');
  first.end(); assert.equal(controls(socket, 'playback.complete').length, 0);
  second.end(); assert.deepEqual(controls(socket, 'playback.complete'), [{ type: 'playback.complete', turn_id: 'one' }]);
  audioStart(socket, 'one'); socket.receive(pcm(32767));
  assert.equal(b.contexts[0].scheduled.length, 2);
  assert.equal(b.session.state, 'listening');
  assert.equal(b.levels.at(-1), 0);
  assert.deepEqual(b.events.filter(event => 'text' in event).map(event => event.text), ['早', '早安', '早安。', '早上', '早上好', '早上好！', '早上好！']);
});

test('local barge-in cancels once and late PCM, errors and playback callbacks cannot revive an old turn', async (t) => {
  const b = browser(t);
  const socket = await b.open();
  speech(socket, 'old'); audioStart(socket, 'old'); socket.receive(pcm(1));
  const context = b.contexts[0];
  const old = context.scheduled[0], staleEnd = old.onended;
  for (let index = 0; index < 4; index++) b.worklets[0].emit(0.2);
  b.session.interrupt();
  assert.equal(old.stopped, true); assert.equal(old.destination, null);
  assert.deepEqual(controls(socket, 'assistant.cancel'), [{ type: 'assistant.cancel', turn_id: 'old' }]);
  assert.deepEqual(controls(socket, 'input.activity'), [{ type: 'input.activity', active: true }]);
  assert.equal(b.session.active, true);
  assert.equal(b.tracks[0].stops, 0);
  audioStart(socket, 'old'); socket.receive(pcm(2));
  speech(socket, 'new'); audioStart(socket, 'new'); socket.receive(pcm(3));
  const current = context.scheduled[1];
  staleEnd();
  socket.receive({ type: 'assistant.cancel', turn_id: 'old' });
  socket.receive({ type: 'error', code: 'seeduplex_timeout', turn_id: 'old' });
  socket.receive({ type: 'assistant.text.delta', turn_id: 'old', text: '迟到' });
  assert.equal(context.scheduled.length, 2);
  assert.equal(b.session.state, 'playing');
  assert.ok(context.live.has(current));
  assert.equal(controls(socket, 'playback.complete').length, 0);
  assert.ok(!b.events.some(event => event.text === '迟到'));
});

test('restarts without accepting late socket callbacks or a delayed permission grant', async (t) => {
  let grantPermission;
  let first = true;
  const b = browser(t, { getMedia: grant => {
    if (first) { first = false; return new Promise(resolve => { grantPermission = () => resolve(grant()); }); }
    return grant();
  } });
  const previous = await b.open();
  const staleMessage = previous.onmessage, staleClose = previous.onclose;
  assert.equal(b.worklets.length, 0);
  const fresh = await b.open();
  grantPermission(); await flush();
  staleClose();
  staleMessage({ data: JSON.stringify({ type: 'input.speech.started', turn_id: 'orphan' }) });
  staleMessage({ data: pcm(1) });
  assert.equal(previous.readyState, 3);
  assert.equal(fresh.readyState, 1);
  assert.equal(b.session.state, 'listening');
  assert.equal(b.tracks[1].stops, 1);
  assert.equal(b.tracks[0].stops, 0);
  assert.equal(b.worklets.length, 1);
  assert.ok(!b.events.some(event => event.turn_id === 'orphan'));
});

test('drops congested uplink frames, reports recovery, and stops when congestion persists', async (t) => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const b = browser(t);
  const socket = await b.open();
  const capture = b.worklets[0];
  socket.bufferedAmount = 128 * 1024 + 1;
  for (let index = 0; index < 30; index++) capture.emit();
  assert.equal(socket.sent.length, 1);
  assert.equal(b.states.at(-1).congested, true);
  socket.bufferedAmount = 0;
  capture.emit();
  assert.equal(b.states.at(-1).congested, false);
  assert.equal(socket.sent.filter(item => item instanceof ArrayBuffer).length, 1);
  socket.bufferedAmount = 128 * 1024 + 1; capture.emit();
  now += 3001; capture.emit();
  assert.equal(b.states.at(-1).code, 'audio_backpressure');
  assert.equal(b.session.active, false);
  assert.equal(socket.sent.filter(item => item instanceof ArrayBuffer).length, 1);
  assert.equal(b.tracks[0].stops, 1);
});

test('a stalled playback device cannot grow the scheduled audio queue without bound', async (t) => {
  const b = browser(t);
  const socket = await b.open();
  speech(socket, 'overload'); audioStart(socket, 'overload');
  for (let index = 0; index < 7; index++) socket.receive(new ArrayBuffer(64000));
  const context = b.contexts[0];
  assert.equal(b.states.at(-1).code, 'audio_backpressure');
  assert.ok(context.scheduled.length > 0 && context.scheduled.length < 7);
  assert.ok(context.scheduled.every(node => node.stopped && node.destination === null));
  assert.equal(context.live.size, 0);
});

test('stopping releases the socket, capture graph, microphone, timers and active player', async (t) => {
  const b = browser(t);
  const socket = await b.open();
  speech(socket, 'playing'); audioStart(socket, 'playing'); socket.receive(pcm(1));
  const [capture] = b.worklets, [context] = b.contexts;
  const lateCapture = capture.port.onmessage;
  b.session.stop(); b.session.stop();
  lateCapture({ data: { pcm: new ArrayBuffer(640), rms: 0.1, peak: 0.2 } });
  assert.equal(b.session.state, 'idle');
  assert.equal(b.session.active, false);
  assert.deepEqual(socket.sent.slice(1), [{ type: 'session.stop' }]);
  assert.equal(socket.readyState, 3);
  for (const name of ['onopen', 'onmessage', 'onerror', 'onclose']) assert.equal(socket[name], null);
  assert.equal(capture.port.onmessage, null); assert.equal(capture.port.closed, true);
  for (const node of [capture, context.source, context.mute, ...context.scheduled]) assert.equal(node.destination, null);
  assert.equal(context.state, 'closed'); assert.equal(context.live.size, 0);
  assert.equal(b.tracks[0].stops, 1); assert.equal(b.tracks[0].onended, null);
  assert.equal(b.timers.size, 0);
});

test('permission denial and revocation report a safe state and release every acquired resource', async (t) => {
  const denied = browser(t, { getMedia: () => Promise.reject(new DOMException('private device info', 'NotAllowedError')) });
  const socket = await denied.open();
  assert.equal(denied.states.at(-1).code, 'microphone_denied');
  assert.ok(!JSON.stringify(denied.states).includes('private device info'));
  assert.equal(socket.readyState, 3); assert.equal(denied.worklets.length, 0);
  assert.equal(denied.contexts[0].state, 'closed'); assert.equal(denied.timers.size, 0);
  const revoked = browser(t);
  const fresh = await revoked.open();
  revoked.tracks[0].onended();
  assert.equal(revoked.states.at(-1).code, 'microphone_denied');
  assert.equal(fresh.readyState, 3); assert.equal(revoked.worklets[0].port.closed, true);
  assert.equal(revoked.tracks[0].stops, 1);
});

test('declines unsupported capture, mismatched protocol and unconfirmed role before recording', async (t) => {
  const unsupported = browser(t);
  delete unsupported.environment.AudioWorkletNode;
  assert.equal(supportsDuplex(unsupported.environment), false);
  assert.equal(await unsupported.session.start({ url, profile }), false);
  assert.equal(unsupported.states.at(-1).code, 'duplex_not_supported');
  assert.equal(unsupported.sockets.length, 0);
  const b = browser(t);
  const linxi = { characterId: 'linxi', personaId: 'linxi', voiceId: 'linxi' };
  for (const [receipt, code] of [
    [{ ...ready, streaming: false }, 'duplex_not_supported'],
    [{ ...ready, output_rate: 16000 }, 'duplex_not_supported'],
    [{ ...ready, character_id: undefined }, 'unsupported_character'],
    [{ ...ready, character_id: 'linxi', persona_id: 'zhixia', voice_id: 'linxi' }, 'unsupported_character'],
    [{ ...ready, character_id: 'linxi', persona_id: 'linxi', voice_id: 'zhixia' }, 'unsupported_character'],
  ]) {
    const socket = await b.open({ profile: linxi }, receipt);
    assert.equal(b.states.at(-1).code, code); assert.equal(socket.readyState, 3);
    assert.equal(b.session.active, false); assert.equal(b.mediaRequests.length, 0);
  }
  await b.open({ profile: linxi }, { ...ready, character_id: 'linxi', persona_id: 'linxi', voice_id: 'linxi' });
  assert.equal(b.session.state, 'listening'); assert.equal(b.worklets.length, 1);
});

test('runs 100 turns on one microphone and socket while draining each turn and releasing audio nodes', async (t) => {
  const b = browser(t);
  const socket = await b.open();
  const context = b.contexts[0];
  for (let index = 1; index <= 100; index++) {
    const id = `turn-${index}`;
    b.worklets[0].emit();
    speech(socket, id); audioStart(socket, id);
    socket.receive(pcm(index)); socket.receive(pcm(-index));
    socket.receive({ type: 'assistant.audio.end', turn_id: id });
    socket.receive({ type: 'turn.end', turn_id: id });
    assert.equal(context.live.size, 2);
    const nodes = context.scheduled.splice(0);
    nodes.forEach(node => node.end());
    assert.equal(context.live.size, 0, `audio graph empty after turn ${index}`);
    assert.ok(nodes.every(node => node.destination === null));
    assert.equal(b.session.state, 'listening');
    assert.equal(b.timers.size, 0);
  }
  // The oldest completed turn is still stale after sustained use of the connection.
  speech(socket, 'turn-1'); audioStart(socket, 'turn-1'); socket.receive(pcm(1));
  assert.equal(context.live.size, 0);
  assert.equal(b.contexts.length, 1); assert.equal(b.sockets.length, 1);
  assert.equal(b.mediaRequests.length, 1); assert.equal(b.worklets.length, 1);
  assert.equal(controls(socket, 'playback.complete').length, 100);
  assert.equal(socket.sent.filter(data => data instanceof ArrayBuffer).length, 100);
  assert.equal(controls(socket, 'input.end').length, 0);
  b.session.stop();
  assert.equal(b.tracks[0].stops, 1);
  assert.equal(context.state, 'closed');
});

test('the served worklet emits continuous 20 ms little-endian PCM from real render blocks', async () => {
  const workletSource = await readFile(new URL('../app/src/composables/voice/worklets/pcm-capture.worklet.js', import.meta.url), 'utf8');
  const packets = [];
  let Processor;
  vm.runInNewContext(workletSource, {
    sampleRate: 48000,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: (packet, transfer) => packets.push(structuredClone(packet, { transfer: [...transfer] })) }; } },
    registerProcessor(name, implementation) { assert.equal(name, 'pcm-capture'); Processor = implementation; },
  });
  assert.equal(typeof Processor, 'function');
  const processor = new Processor();
  const block = new Float32Array(128).fill(-0.5);
  for (let index = 0; index < 30; index++) assert.equal(processor.process([[block]]), true);
  assert.equal(packets.length, 4);
  for (const { pcm: data, rms, peak } of packets) {
    assert.equal(data.byteLength, 640);
    assert.equal(new DataView(data).getInt16(2, true), -16384);
    assert.equal(rms, 0.5); assert.equal(peak, 0.5);
  }
});
