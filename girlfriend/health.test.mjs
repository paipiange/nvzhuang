import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import { createAppServer } from './server.mjs';

const statusData = { components: [
  { name: 'Qwen LLM', available: true, url: 'private-model-url', message: 'private-status-message' },
  { name: 'FunASR', available: false },
  { name: 'CosyVoice TTS', available: true },
], models: [{ path: 'private-model-path' }] };
const envelope = data => new Response(JSON.stringify({ code: 0, data, request_id: 'private-request-id' }), { headers: { 'Content-Type': 'application/json' } });
const expected = { backendAvailable: true, models: { qwen: { available: true }, funasr: { available: false }, cosyvoice: { available: true } }, seedKeyConfigured: true };
async function withServer(fetchImpl, action) {
  const server = createAppServer({ fetchImpl });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const query = base => `/api/local-voice-health?baseURL=${encodeURIComponent(base)}`;
  const check = (base = 'http://localhost:8000', headers = {}) => fetch(origin + query(base), { headers: { Origin: origin, 'X-Companion-Request': 'voice-health', ...headers } });
  try { await action({ origin, check, query }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('health projects only three fixed service states and Seed configuration without forwarding private headers', async () => {
  const calls = [];
  await withServer(async (address, options) => {
    calls.push({ address, options });
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.deepEqual(options.headers, { Accept: 'application/json' });
    assert.equal(address.search, '');
    assert.ok(options.signal instanceof AbortSignal);
    return address.pathname.endsWith('/status') ? envelope(statusData) : envelope({ seeduplex_api_key_configured: true, tasks: [{ message: 'private-task-value' }], key: 'private-key-value' });
  }, async ({ check }) => {
    const response = await check('http://localhost:8000/ignored-prefix');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.deepEqual(calls.map(({ address }) => address.href).sort(), ['http://localhost:8000/api/v1/voice/status', 'http://localhost:8000/api/v1/voice/tasks']);
  });
});

test('health rejects cross-origin, mismatched loopback port, malformed origin and missing request proof before fetching', async () => {
  let calls = 0;
  await withServer(async () => { calls++; throw new Error('must not fetch'); }, async ({ origin, check, query }) => {
    for (const supplied of ['https://example.com', 'http://localhost:12345', 'http://127.0.0.1:1', `${origin}/`, 'null']) {
      assert.equal((await check(undefined, { Origin: supplied })).status, 403);
    }
    assert.equal((await fetch(origin + query('http://localhost:8000'), { headers: { Origin: origin } })).status, 403);
    assert.equal((await fetch(origin + query('http://localhost:8000'), { headers: { 'X-Companion-Request': 'voice-health', 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await fetch(origin + query('http://localhost:8000'), { method: 'OPTIONS', headers: { Origin: 'https://example.com', 'Access-Control-Request-Headers': 'X-Companion-Request' } })).status, 404);
    assert.equal(calls, 0);
  });
});

test('browser same-origin fetch metadata works without an Origin header and rejects remote or credentialed targets', async () => {
  let calls = 0;
  await withServer(async address => { calls++; return address.pathname.endsWith('/status') ? envelope(statusData) : envelope({ seeduplex_api_key_configured: false }); }, async ({ origin, check, query }) => {
    const response = await fetch(origin + query('http://localhost:8000'), { headers: { 'X-Companion-Request': 'voice-health', 'Sec-Fetch-Site': 'same-origin' } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).seedKeyConfigured, false);
    assert.equal(calls, 2);
    for (const address of ['https://example.com', 'http://example.com', 'http://user:pass@localhost:8000', 'http://localhost:8000?token=private', 'http://localhost:8000/#private']) {
      assert.equal((await check(address)).status, 400);
    }
    assert.equal((await fetch(origin + query('http://localhost:8000') + '&apiKey=private', { headers: { Origin: origin, 'X-Companion-Request': 'voice-health' } })).status, 400);
    assert.equal(calls, 2);
  });
});

test('missing task metadata reports unknown Seed configuration without claiming working local models are unavailable', async () => {
  await withServer(async address => address.pathname.endsWith('/status') ? envelope(statusData) : new Response('', { status: 404 }), async ({ check }) => {
    const response = await check();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ...expected, seedKeyConfigured: null });
  });
});

test('invalid backend envelopes fail safely and never expose upstream errors or paths', async () => {
  for (const data of [{ code: 500, message: 'private error' }, { code: 0, data: { components: 'private path' } }, null]) {
    await withServer(async address => address.pathname.endsWith('/status') ? new Response(JSON.stringify(data)) : envelope({ seeduplex_api_key_configured: 'private key' }), async ({ check }) => {
      const response = await check();
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { backendAvailable: false, models: { qwen: { available: false }, funasr: { available: false }, cosyvoice: { available: false } }, seedKeyConfigured: null });
    });
  }
});

test('oversized declared and streamed health responses are cancelled and never reflected', async () => {
  for (const declared of [true, false]) {
    let cancelled = false;
    await withServer(async address => {
      if (address.pathname.endsWith('/tasks')) return envelope({ seeduplex_api_key_configured: false });
      return new Response(new ReadableStream({
        start(controller) { if (!declared) controller.enqueue(new TextEncoder().encode('x'.repeat(33 * 1024))); },
        cancel() { cancelled = true; },
      }), { headers: declared ? { 'Content-Length': String(33 * 1024) } : {} });
    }, async ({ check }) => {
      const response = await check();
      assert.equal(response.status, 503);
      assert.equal((await response.json()).backendAvailable, false);
      assert.equal(cancelled, true);
    });
  }
});

test('health fetches have a five-second abort deadline and return bounded safe failure', { timeout: 7000 }, async () => {
  let aborted = 0;
  await withServer(async (_address, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => { aborted++; reject(new Error('private transport error')); }, { once: true });
  }), async ({ check }) => {
    const response = await check();
    assert.equal(response.status, 503);
    const data = await response.json();
    assert.equal(data.backendAvailable, false);
    assert.equal(data.seedKeyConfigured, null);
    assert.equal(aborted, 2);
  });
});

const appSource = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const healthSource = appSource.slice(appSource.indexOf('function getValidLocalBackend('), appSource.indexOf('function getValidSeedConfig('));
function client(fetchImpl) {
  const element = () => ({ value: '', hidden: true, disabled: false, textContent: '', attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } });
  const elements = { localBackendURL: element(), chatMode: element(), voiceHealthStatus: element(), checkVoiceHealth: element() };
  elements.localBackendURL.value = 'http://localhost:9000';
  elements.chatMode.value = 'local';
  const requests = [];
  const timers = new Map();
  const context = vm.createContext({ elements, URL, AbortController, voiceHealthController: null, voiceHealthGeneration: 0, window: { location: new URL('http://localhost:8787/') },
    fetch: async (address, options) => { requests.push({ address, options }); return fetchImpl(address, options); },
    setTimeout: (fn, ms) => { timers.set(1, { fn, ms }); return 1; }, clearTimeout: id => timers.delete(id),
    localStorage: new Proxy({}, { get() { throw new Error('health must not access local storage'); } }),
  });
  vm.runInContext(healthSource, context);
  return { elements, requests, timers, check: () => vm.runInContext('checkVoiceHealth()', context), cancel: () => vm.runInContext("cancelVoiceHealth('地址已更改，请重新检查。')", context) };
}

test('settings check uses current unsaved address without Key, chat, persistence or model requests', async () => {
  const app = client(async () => ({ ok: true, json: async () => expected }));
  await app.check();
  assert.equal(app.requests.length, 1);
  const { address, options } = app.requests[0];
  assert.equal(new URL(address, 'http://localhost:8787').searchParams.get('baseURL'), 'http://localhost:9000');
  assert.equal(options.method, 'GET');
  assert.equal(options.body, undefined);
  assert.deepEqual(Object.keys(options.headers).sort(), ['Accept', 'X-Companion-Request']);
  assert.match(app.elements.voiceHealthStatus.textContent, /FunASR/);
  assert.match(app.elements.voiceHealthStatus.textContent, /未就绪/);
  assert.equal(app.elements.checkVoiceHealth.disabled, false);
  assert.equal(app.timers.size, 0);
  app.elements.chatMode.value = 'seeduplex';
  await app.check();
  assert.match(app.elements.voiceHealthStatus.textContent, /账号权限/);
  assert.match(app.elements.voiceHealthStatus.textContent, /不依赖这三个本机模型/);
});

test('settings check distinguishes missing Seed configuration and ignores late result after address changes', async () => {
  let resolve;
  const app = client(async () => new Promise(done => { resolve = done; }));
  const pending = app.check();
  assert.equal(app.elements.checkVoiceHealth.disabled, true);
  assert.equal(app.elements.checkVoiceHealth.attributes['aria-busy'], 'true');
  app.cancel();
  resolve({ ok: true, json: async () => expected });
  await pending;
  assert.match(app.elements.voiceHealthStatus.textContent, /地址已更改/);
  assert.equal(app.requests[0].options.signal.aborted, true);
  const seed = client(async () => ({ ok: true, json: async () => ({ ...expected, seedKeyConfigured: false }) }));
  seed.elements.chatMode.value = 'seeduplex';
  await seed.check();
  assert.match(seed.elements.voiceHealthStatus.textContent, /后端未配置豆包 Key/);
  assert.match(seed.elements.voiceHealthStatus.textContent, /未读取或发送浏览器 Key/);
});

test('settings check rejects invalid form targets without network and gives safe timeout feedback', async () => {
  const app = client(async () => { throw new Error('must not fetch'); });
  app.elements.localBackendURL.value = 'https://example.com';
  await app.check();
  assert.equal(app.requests.length, 0);
  assert.match(app.elements.voiceHealthStatus.textContent, /地址无效/);
  const stalled = client(async (_address, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
  const pending = stalled.check();
  assert.equal(stalled.timers.get(1).ms, 7000);
  stalled.timers.get(1).fn();
  await pending;
  assert.match(stalled.elements.voiceHealthStatus.textContent, /检查超时/);
  assert.equal(stalled.elements.checkVoiceHealth.disabled, false);
  assert.equal(stalled.timers.size, 0);
});
