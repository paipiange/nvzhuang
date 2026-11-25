import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { createServer as createHTTPServer } from 'node:http';
import { formatBackend, formatPage, inspectBackend, inspectLocalSocket, inspectPage, localOrigin, portIsFree, portNumber, runCLI } from './doctor.mjs';

class LocalSocket {
  static frames = [];
  static metadata = { character_id: 'zhixia', persona_id: 'zhixia', voice_id: 'zhixia' };
  constructor(url) {
    assert.equal(new URL(url).hostname, '127.0.0.1');
    queueMicrotask(() => this.onopen?.());
  }
  send(data) {
    const event = JSON.parse(data);
    assert.equal(event.type, 'session.start');
    assert.equal(event.provider, 'local');
    assert.equal(event.api_key, undefined);
    assert.equal(event.text, undefined);
    LocalSocket.frames.push(event);
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'session.ready', ...LocalSocket.metadata }) }));
  }
  close() { this.closed = true; }
}

function json(value) { return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }); }

test('only accepts loopback origins and numeric ports', () => {
  assert.equal(localOrigin('http://localhost:8787/'), 'http://localhost:8787');
  assert.equal(localOrigin('http://[::1]:8000'), 'http://[::1]:8000');
  for (const input of ['https://example.com', 'http://127.0.0.1@evil.invalid', 'http://localhost/?api_key=secret', 'http://localhost/private', 'http://user:secret@localhost', 'file:///tmp'])
    assert.throws(() => localOrigin(input));
  assert.equal(portNumber('8787'), 8787);
  for (const value of ['0', '-1', '65536', '8787&whoami', undefined]) assert.throws(() => portNumber(value));
});

test('finds occupied local ports without stopping their owners', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    assert.equal(await portIsFree(port), false);
    assert.equal(server.listening, true);
  } finally { await new Promise(resolve => server.close(resolve)); }
  assert.equal(await portIsFree(port), true);
});

test('reports stale static module routes as requiring service restart, without reading bodies', async () => {
  const result = await inspectPage('http://127.0.0.1:8787', async (url, options) => {
    assert.equal(options.redirect, 'error');
    const missing = new URL(url).pathname.endsWith('.mjs');
    return new Response('PRIVATE CONFIG AND CHAT MUST NOT PRINT', { status: missing ? 404 : 200 });
  });
  assert.equal(result.running, true);
  assert.equal(result.ready, false);
  const output = formatPage(result).join('\n');
  assert.match(output, /模块缺失.*需要关闭旧页面服务/);
  assert.match(output, /character-state.mjs: status=404/);
  assert.match(output, /duplex-session.mjs: status=404/);
  assert.doesNotMatch(output, /PRIVATE CONFIG/);
});

test('projects backend status to fixed component booleans and key presence only', async () => {
  LocalSocket.metadata = { character_id: 'zhixia', persona_id: 'zhixia', voice_id: 'zhixia' };
  const result = await inspectBackend('http://127.0.0.1:8000', async url => json(url.endsWith('/tasks')
    ? { code: 0, data: { seeduplex_api_key_configured: false, api_key: 'SECRET-NOT-PRINTED', privateConfig: 'private' } }
    : { code: 0, data: { components: [
      { name: 'Qwen LLM', available: true, url: 'private-service', message: 'private-chat' },
      { name: 'FunASR', available: false }, { name: 'CosyVoice TTS', available: true },
      { name: 'private-extra', available: true },
    ], models: [{ path: 'private-model-path' }] } }), LocalSocket);
  assert.equal(result.keyConfigured, false);
  assert.deepEqual(result.socket, { ready: true, profileAware: true });
  const output = formatBackend(result).join('\n');
  assert.match(output, /FunASR: available=false/);
  assert.match(output, /缺少本地模型服务/);
  assert.match(output, /未配置服务端 SeedDuplex Key/);
  assert.doesNotMatch(JSON.stringify(result) + output, /SECRET-NOT-PRINTED|private-/);
  assert.equal(LocalSocket.frames.at(-1).provider, 'local');
});

test('detects old backend profile capability without cloud negotiation', async () => {
  LocalSocket.metadata = {};
  const socket = await inspectLocalSocket('http://127.0.0.1:8000', LocalSocket);
  assert.deepEqual(socket, { ready: true, profileAware: false });
  const lines = formatBackend({ statusAvailable: true, components: [], keyConfigured: null, socket }).join('\n');
  assert.match(lines, /检测到旧后端/);
  assert.equal(LocalSocket.frames.every(frame => frame.provider === 'local' && !('api_key' in frame)), true);
});

test('sanitizes fetch failures and invalid JSON, including oversized local responses', async () => {
  const result = await inspectBackend('http://127.0.0.1:8000', async () => {
    throw new Error('SECRET-CONFIG-WITH-KEY');
  }, LocalSocket);
  assert.equal(result.statusAvailable, false);
  assert.equal(result.components.every(item => item.available === null), true);
  assert.doesNotMatch(formatBackend(result).join('\n'), /SECRET/);
  const oversized = await inspectBackend('http://127.0.0.1:8000', async () => new Response('x'.repeat(128 * 1024 + 1)), LocalSocket);
  assert.equal(oversized.statusAvailable, false);
  const malformed = await inspectBackend('http://127.0.0.1:8000', async () => json({ code: 0, data: { components: { find: 'not-a-function' } } }), LocalSocket);
  assert.equal(malformed.statusAvailable, false);
});

test('CLI prints one scalar status per line and succeeds for complete page resources', async () => {
  const server = createHTTPServer((_req, res) => { res.writeHead(200); res.end('ok'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const lines = [];
  try {
    const exit = await runCLI(['--page-only', '--page', `http://127.0.0.1:${server.address().port}`], (...items) => {
      assert.equal(items.length, 1);
      assert.equal(typeof items[0], 'string');
      lines.push(items[0]);
    });
    assert.equal(exit, 0);
    assert.equal(lines.filter(line => line.includes('status=200')).length, 5);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('CLI rejects remote or credential-bearing addresses without echoing supplied secrets', async () => {
  const output = [];
  const exit = await runCLI(['--page', 'http://secret:never-print@remote.invalid'], line => output.push(line));
  assert.equal(exit, 2);
  assert.doesNotMatch(output.join('\n'), /never-print|remote.invalid/);
});
