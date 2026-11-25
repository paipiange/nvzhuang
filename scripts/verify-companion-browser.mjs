import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAppServer } from '../girlfriend/server.mjs';

// Isolated browser profile; default simulates transport, --local uses only the existing local models.
const realLocal = process.argv.includes('--local');
const candidates = [process.env.CHROME_PATH, path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'), path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe')].filter(Boolean);
let chrome;
for (const candidate of candidates) { try { await access(candidate); chrome = candidate; break; } catch {} }
assert.ok(chrome, 'Set CHROME_PATH to a Chromium browser executable');
const profile = await mkdtemp(path.join(os.tmpdir(), 'companion-browser-'));
const livePage = process.env.COMPANION_PAGE_URL;
const liveURL = livePage ? new URL(livePage) : null;
if (liveURL) assert.ok(liveURL.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(liveURL.hostname) && !liveURL.username && !liveURL.password && !liveURL.search && !liveURL.hash && liveURL.pathname === '/', 'Only a loopback page origin is allowed');
const server = liveURL ? null : createAppServer();
if (server) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = liveURL ? liveURL.href : `http://127.0.0.1:${server.address().port}`;
const processHandle = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
const events = [];
const callbacks = new Map();
let sequence = 0;
async function send(method, params = {}) {
  const id = ++sequence;
  const result = new Promise((resolve, reject) => callbacks.set(id, { resolve, reject }));
  ws.send(JSON.stringify({ id, method, params }));
  return result;
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + (result.exceptionDetails.exception?.description || ''));
  return result.result.value;
}
async function waitFor(expression, label) {
  for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(50); }
  const snapshot = await evaluate("({mode:document.querySelector('#chat-mode')?.value,formError:document.querySelector('#form-error')?.textContent,hidden:document.querySelector('#duplex-button')?.hidden,disabled:document.querySelector('#duplex-button')?.disabled,hint:document.querySelector('#duplex-hint')?.textContent,formValid:document.querySelector('#settings-form')?.checkValidity(),worklet:'audioWorklet' in AudioContext.prototype})");
  console.error(JSON.stringify({ label, snapshot, exceptions: events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails.text) }));
  throw new Error(`Timed out: ${label}`);
}
try {
  const { readFile } = await import('node:fs/promises');
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (port) break; } catch {}
    await delay(50);
  }
  assert.ok(port, 'Browser remote debugging started');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) { const callback = callbacks.get(message.id); callbacks.delete(message.id); message.error ? callback?.reject(new Error(message.error.message)) : callback?.resolve(message.result); }
    else events.push(message);
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    globalThis.__voiceSmoke = { sockets: [], frames: 0, stoppedTracks: 0, contexts: [] };
    const NativeContext = AudioContext;
    globalThis.AudioContext = class extends NativeContext { constructor(...args) { super(...args); __voiceSmoke.contexts.push(this); } };
    const originalMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => { const stream = await originalMedia(...args); for (const track of stream.getTracks()) { track.enabled = false; const stop = track.stop.bind(track); track.stop = () => { __voiceSmoke.stoppedTracks++; stop(); }; } return stream; };
    if (!${realLocal}) globalThis.WebSocket = class {
      static OPEN = 1; readyState = 0; bufferedAmount = 0;
      constructor(url) { this.url = url; __voiceSmoke.sockets.push(this); setTimeout(() => { this.readyState=1; this.onopen?.(); }, 10); }
      send(data) { if (typeof data !== 'string') { if (data.byteLength === 640) __voiceSmoke.frames++; return; } const e=JSON.parse(data); this.sent ??=[]; this.sent.push(e); if(e.type==='session.start')setTimeout(()=>this.receive({type:'session.ready',streaming:true,codec:'pcm_s16le',channels:1,input_rate:16000,output_rate:24000,character_id:e.character_id,persona_id:e.persona_id,voice_id:e.voice_id}),10); }
      receive(e) { this.onmessage?.({ data: typeof e==='object' && !(e instanceof ArrayBuffer) ? JSON.stringify(e) : e }); }
      close() { this.readyState=3; this.onclose?.(); }
    };
    if (${realLocal}) {
      const NativeSocket=WebSocket;
      globalThis.__voiceSmoke.live={bytes:0,segments:0,turns:0,textCharacters:0,playbackEnds:0,codes:[]};
      globalThis.WebSocket=class extends NativeSocket {constructor(...args){super(...args);this.addEventListener('message',({data})=>{const stats=__voiceSmoke.live;if(typeof data==='string'){const e=JSON.parse(data);if(e.type==='assistant.audio.start')stats.segments++;if(e.type==='turn.end')stats.turns++;if(e.type==='assistant.text.delta')stats.textCharacters+=(e.text||'').length;if(e.type==='error')stats.codes.push(e.code);}else stats.bytes+=data.byteLength||data.size||0;});}};
      const NativeAudio=Audio;
      globalThis.Audio=class extends NativeAudio {constructor(...args){super(...args);this.addEventListener('ended',()=>__voiceSmoke.live.playbackEnds++);}};
    }
  ` });
  await send('Page.navigate', { url });
  await waitFor("document.readyState === 'complete' && document.querySelector('#duplex-button') && document.querySelector('#chat-mode')", 'page initialized');
  for (const width of [375, 1440]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    const layout = await evaluate("({width:innerWidth,scroll:document.documentElement.scrollWidth,send:document.querySelector('#send-button').getBoundingClientRect().width,mic:document.querySelector('#mic-button').getBoundingClientRect().width})");
    assert.ok(layout.scroll <= layout.width + 1, `No page overflow at ${width}px`);
    assert.ok(layout.send >= 24 && layout.mic >= 24, 'Primary composer controls remain operable');
  }
  await send('Emulation.clearDeviceMetricsOverride');
  await evaluate("document.querySelector('#open-settings').click();document.querySelector('#check-voice-health').click()");
  await waitFor("!document.querySelector('#check-voice-health').disabled && !document.querySelector('#voice-health-status').hidden", 'settings health check completed');
  const healthText = await evaluate("document.querySelector('#voice-health-status').textContent");
  assert.match(healthText, /后端可连接/, 'Settings shows successful real local backend diagnostic');
  assert.match(healthText, /均已就绪/, 'Settings shows three real local models ready');
  await evaluate("document.querySelector('#close-settings').click()");
  let result;
  if (realLocal) {
    await evaluate("document.querySelector('#message-input').value='请用一句简短的中文介绍你自己，不超过十五个字。';document.querySelector('#composer-form').requestSubmit();");
    for(let attempt=0;attempt<1200;attempt++) {
      result=await evaluate('__voiceSmoke.live');
      if(result.codes.length || (result.turns>0 && result.bytes>0 && result.playbackEnds===result.segments)) break;
      await delay(100);
    }
    assert.deepEqual(result.codes, [], 'local pipeline returned no error codes');
    assert.ok(result.textCharacters>0 && result.bytes>44 && result.turns>0, 'local Qwen and CosyVoice produced text and WAV');
    assert.equal(result.playbackEnds,result.segments,'real HTMLAudio played every local WAV segment');
    await evaluate("document.querySelector('#clear-local-memory').click()");
  } else {
  await evaluate("document.querySelector('#open-settings').click(); document.querySelector('#chat-mode').value='seeduplex';document.querySelector('#chat-mode').dispatchEvent(new Event('change'));document.querySelector('#settings-form').requestSubmit();");
  await waitFor("!document.querySelector('#duplex-button').hidden && !document.querySelector('#duplex-button').disabled", 'continuous call available');
  await evaluate("document.querySelector('#duplex-button').click()");
  await waitFor('__voiceSmoke.frames >= 5', 'real AudioWorklet produced PCM frames');
  result = await evaluate(`(async()=>{
    const socket=__voiceSmoke.sockets.at(-1);
    for(let i=0;i<100;i++) {
      const turn='browser-'+i;
      socket.receive({type:'input.speech.started',turn_id:turn});
      socket.receive({type:'asr.final',turn_id:turn,text:'第'+i+'轮测试'});
      socket.receive({type:'input.speech.stopped',turn_id:turn});
      socket.receive({type:'assistant.text.final',turn_id:turn,text:'本地浏览器回归回复'+i});
      socket.receive({type:'assistant.audio.start',turn_id:turn,codec:'pcm_s16le',sample_rate:24000,channels:1});
      socket.receive(new ArrayBuffer(480));
      socket.receive({type:'assistant.audio.end',turn_id:turn});
      socket.receive({type:'turn.end',turn_id:turn});
      for (let wait=0;wait<100 && !socket.sent.some(e=>e.type==='playback.complete' && e.turn_id===turn);wait++) await new Promise(r=>setTimeout(r,20));
      if (!socket.sent.some(e=>e.type==='playback.complete' && e.turn_id===turn)) throw new Error('Playback did not complete: '+turn);
    }
    return {frames:__voiceSmoke.frames,complete:socket.sent.filter(e=>e.type==='playback.complete').length,button:document.querySelector('#duplex-button').textContent};
  })()`);
  assert.equal(result.complete, 100, '100 turns complete using real Web Audio playback');
  assert.ok(result.frames >= 5);
  await evaluate("document.querySelector('#duplex-button').click()");
  await waitFor('__voiceSmoke.stoppedTracks > 0 && __voiceSmoke.contexts.every(c=>c.state === "closed")', 'all media resources released');
  }
  const errors = events.filter(e => e.method === 'Runtime.exceptionThrown');
  assert.equal(errors.length, 0, 'No browser runtime exceptions');
  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const screenshotPath = path.join(profile, 'companion-smoke.png');
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  console.log(JSON.stringify({ passed: true, simulatedNetwork: !realLocal, realLocalModels: realLocal, realBrowserAudioWorklet: !realLocal, ...result, screenshot: screenshotPath }, null, 2));
} finally {
  ws?.close();
  processHandle.kill();
  if (server) await new Promise(resolve => server.close(resolve));
}
