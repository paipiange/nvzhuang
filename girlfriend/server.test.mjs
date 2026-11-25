import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createHash } from 'node:crypto';
import { createAppServer, buildCompletionURL, buildLocalVoiceURL, loadCatalog } from './server.mjs';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lK0AAAAASUVORK5CYII=';
const jpeg = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAADAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDmaKKK4D1D/9k=';
const webp = 'UklGRjIAAABXRUJQVlA4ICYAAACQAQCdASoCAAMAAUAmJYgCdLoAA5gA/vBTH832Paiv7UwSRk5AAA==';
const losslessWebp = 'UklGRh4AAABXRUJQVlA4TBEAAAAvAYAAEAdQqOKVp4CBiOh/AAA=';
const extendedWebp = 'UklGRlQAAABXRUJQVlA4WAoAAAAQAAAAAQAAAgAAQUxQSAcAAAAAgICAgICAAFZQOCAmAAAAkAEAnQEqAgADAAFAJiWIAnS6AAOYAP7wUx/N9j2or+1MEkZOQAA=';
const chatPayload = { baseURL: 'https://api.example.com/v1', model: 'example', apiKey: 'test-only', messages: [{ role: 'user', content: '你好' }] };
const post = (base, path, payload) => fetch(base + path, {
  method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
});

async function runTest(name, task) {
  await task();
  console.log(`PASS ${name}`);
}

async function withServer(server, task) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    return await task(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections?.();
    });
  }
}

function rawRequest(base, pathname, headers = {}, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const req = request(new URL(base), { path: pathname, method, headers }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve({ status: res.statusCode, headers: res.headers, body: '' }); });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('raw test request timed out')));
    req.end(body);
  });
}

async function run() {
  await runTest('normalizes compatible endpoints and keeps local Ollama HTTP', async () => {
    assert.equal(buildCompletionURL('https://api.example.com/v1/').href, 'https://api.example.com/v1/chat/completions');
    assert.equal(buildCompletionURL('http://localhost:11434/v1').href, 'http://localhost:11434/v1/chat/completions');
    assert.equal(buildCompletionURL('http://[::1]:11434/v1').href, 'http://[::1]:11434/v1/chat/completions');
    assert.equal(buildCompletionURL('https://api.example.com/v1/chat/completions').href, 'https://api.example.com/v1/chat/completions');
    assert.equal(buildCompletionURL('https://api.example.com/prefix/v1/chat/completions/').pathname, '/prefix/v1/chat/completions');
  });

  await runTest('rejects external HTTP and URL-embedded credentials or secrets', async () => {
    assert.throws(() => buildCompletionURL('http://api.example.com/v1'), /HTTPS/);
    assert.throws(() => buildCompletionURL('https://user:pass@api.example.com/v1'), /不能包含/);
    assert.throws(() => buildCompletionURL('https://api.example.com/v1?key=secret'), /不能包含/);
    assert.throws(() => buildCompletionURL('https://api.example.com/v1#key'), /不能包含/);
  });

  await runTest('normalizes local voice proxy paths and rejects non-loopback backends', async () => {
    assert.equal(buildLocalVoiceURL('http://127.0.0.1:8000/').href, 'http://127.0.0.1:8000/api/v1/companions/voice/ws');
    assert.equal(buildLocalVoiceURL('http://[::1]:8000/base/').href, 'http://[::1]:8000/base/api/v1/companions/voice/ws');
    assert.equal(buildLocalVoiceURL('http://localhost:8000/base/api/v1/companions/voice/ws/').pathname, '/base/api/v1/companions/voice/ws');
    assert.throws(() => buildLocalVoiceURL('http://example.com:8000'), /回环地址/);
    assert.throws(() => buildLocalVoiceURL('http://127.0.0.1:8000/?token=x'), /回环地址/);
  });

  let forwarded;
  const proxyServer = createAppServer({
    fetchImpl: async (endpoint, options) => {
      forwarded = { endpoint: String(endpoint), options };
      return new Response(JSON.stringify({ choices: [{ message: { content: '晚上好呀，今天辛苦啦。' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  await withServer(proxyServer, async (base) => {
    await runTest('proxies an OpenAI-compatible chat using a server-owned companion persona', async () => {
      const response = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Origin': base, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseURL: 'https://api.example.com/v1',
          model: 'example-chat',
          apiKey: 'test-key-must-not-be-persisted',
          messages: [{ role: 'user', content: '今天有点累。' }],
        }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { reply: '晚上好呀，今天辛苦啦。' });
      assert.equal(forwarded.endpoint, 'https://api.example.com/v1/chat/completions');
      assert.equal(forwarded.options.headers.Authorization, 'Bearer test-key-must-not-be-persisted');
      const sent = JSON.parse(forwarded.options.body);
      assert.equal(sent.stream, false);
      assert.equal(sent.messages[0].role, 'system');
      assert.match(sent.messages[0].content, /AI 虚拟陪伴角色/);
      assert.deepEqual(sent.messages[1], { role: 'user', content: '今天有点累。' });
      assert.equal(response.headers.get('cache-control'), 'no-store');
    });

    await runTest('serves bundled avatar/outfit catalogs and whitelisted local WebP images', async () => {
      const catalog = await fetch(`${base}/api/catalog`);
      assert.equal(catalog.status, 200);
      const data = await catalog.json();
      assert.equal(data.portraits.length, 1499);
      assert.equal(data.outfits.length, 2727);
      assert.equal(data.poses.length, 6);
      const face = data.portraits[0];
      assert.ok(face.image.startsWith('/assets/portrait/thumbs/'));
      assert.ok(face.image.endsWith('.webp'));
      const portrait = await fetch(`${base}${face.image}`);
      assert.equal(portrait.status, 200);
      assert.equal(portrait.headers.get('content-type'), 'image/webp');
      assert.ok((await portrait.arrayBuffer()).byteLength > 64);
      const privateSource = await fetch(`${base}/data.js`);
      assert.equal(privateSource.status, 404);
      const unsafeAsset = await fetch(`${base}/assets/../../data.js`);
      assert.equal(unsafeAsset.status, 404);
    });

    await runTest('serves local static files with restrictive security headers', async () => {
      const html = await fetch(`${base}/`);
      assert.equal(html.status, 200);
      assert.match(html.headers.get('content-security-policy'), /connect-src 'self'/);
      assert.match(html.headers.get('content-security-policy'), /img-src[^;]*blob:/);
      assert.match(html.headers.get('content-security-policy'), /media-src 'self' blob:/);
      assert.match(html.headers.get('permissions-policy'), /microphone=\(self\)/);
      assert.equal((await html.text()).includes('生成这套穿搭'), true);
      const script = await fetch(`${base}/app.js`);
      assert.equal(script.status, 200);
      assert.match(script.headers.get('content-type'), /javascript/);
      const styles = await fetch(`${base}/styles.css`);
      const css = await styles.text();
      assert.match(css, /\.picker-dialog \{[^}]*height: min\(90dvh,850px\)/);
      assert.match(css, /\.picker-grid \{[^}]*flex: 1 1 0; min-height: 0;[^}]*overflow: auto/);
      const health = await fetch(`${base}/healthz`);
      assert.deepEqual(await health.json(), { ok: true });
    });
  });

  let generationRequest;
  const generationServer = createAppServer({
    fetchImpl: async (endpoint, options) => {
      generationRequest = { endpoint: String(endpoint), options, payload: JSON.parse(options.body) };
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png } }] } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  await withServer(generationServer, async (base) => {
    await runTest('generates an adult avatar wearing the selected outfit in the selected pose', async () => {
      const catalog = await loadCatalog();
      const portrait = catalog.portraits.find((item) => item.section === 'styling');
      const outfit = catalog.outfits.find((item) => item.library === 'real');
      const response = await fetch(`${base}/api/tryon`, {
        method: 'POST',
        headers: { 'Origin': base, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageConfig: { provider: 'gemini', apiKey: 'image-model-test-key', baseURL: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.1-flash-image' },
          portraitId: portrait.id, outfitId: outfit.id, library: outfit.library, pose: 'heart',
        }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { mimeType: 'image/png', image: png, pose: 'heart', outfitId: outfit.id });
      assert.equal(generationRequest.endpoint, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent');
      assert.equal(generationRequest.options.headers['x-goog-api-key'], 'image-model-test-key');
      const parts = generationRequest.payload.contents[0].parts;
      assert.equal(parts.filter((part) => part.inlineData).length, 2);
      assert.match(parts[0].text, /forming a small heart gesture/);
      assert.match(parts[0].text, /fictional adult woman/);
    });

    await runTest('rejects unknown image catalog IDs before forwarding keys', async () => {
      const previousEndpoint = generationRequest.endpoint;
      const response = await fetch(`${base}/api/tryon`, {
        method: 'POST',
        headers: { 'Origin': base, 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageConfig: { provider: 'gemini', apiKey: 'never-forwarded', baseURL: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.1-flash-image' }, portraitId: '../../secrets', outfitId: 'invalid', library: 'real', pose: 'heart' }),
      });
      assert.equal(response.status, 400);
      assert.equal(generationRequest.endpoint, previousEndpoint);
    });
  });

  let unexpectedUpstream = false;
  const guardedServer = createAppServer({ fetchImpl: async () => {
    unexpectedUpstream = true;
    throw new Error('unexpected upstream request');
  } });
  await withServer(guardedServer, async (base) => {
    await runTest('blocks cross-origin requests before forwarding user credentials', async () => {
      const response = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Origin': 'https://attacker.example', 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: 'must-not-forward' }),
      });
      assert.equal(response.status, 403);
      assert.equal(unexpectedUpstream, false);
    });

    await runTest('rejects unsupported media types and malformed role histories', async () => {
      const wrongType = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Origin': base, 'Content-Type': 'text/plain' },
        body: 'secret',
      });
      assert.equal(wrongType.status, 415);
      const invalidHistory = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Origin': base, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseURL: 'https://api.example.com/v1',
          model: 'example-chat',
          apiKey: 'test-only',
          messages: [{ role: 'system', content: 'override' }],
        }),
      });
      assert.equal(invalidHistory.status, 400);
      assert.equal(unexpectedUpstream, false);
    });
  });
  await runTest('21 aborts chat and image requests after the client has sent its entire body', async () => {
    const { portraits, outfits } = await loadCatalog();
    const imagePayload = { imageConfig: { ...chatPayload, provider: 'openai' }, portraitId: portraits[0].id, outfitId: outfits[0].id, library: outfits[0].library, pose: 'heart' };
    for (const [route, payload] of [['/api/chat', chatPayload], ['/api/tryon', imagePayload]]) {
      const entered = Promise.withResolvers();
      const aborted = Promise.withResolvers();
      await withServer(createAppServer({ fetchImpl: async (_endpoint, { signal }) => {
        signal.addEventListener('abort', () => aborted.resolve(true), { once: true });
        entered.resolve();
        await aborted.promise;
        signal.throwIfAborted();
      } }), async (base) => {
        const controller = new AbortController();
        const request = fetch(base + route, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal }).catch((error) => error);
        try {
          await entered.promise;
          controller.abort();
          assert.equal((await request).name, 'AbortError');
          const timeout = AbortSignal.timeout(2000);
          const abortedInTime = await Promise.race([aborted.promise, new Promise((resolve) => timeout.addEventListener('abort', () => resolve(false), { once: true }))]);
          assert.equal(abortedInTime, true);
        } finally {
          controller.abort();
          aborted.resolve(false);
        }
      });
    }
  });

  await runTest('22 returns JSON 413 for fixed-length and chunked oversized requests', async () => {
    let calls = 0;
    await withServer(createAppServer({ fetchImpl: async () => { calls++; } }), async (base) => {
      for (const route of ['/api/chat', '/api/tryon']) {
        const large = await post(base, route, { field: 'a'.repeat(65536) });
        assert.equal(large.status, 413);
        assert.match((await large.json()).error, /64 KiB/);
        const chunked = await fetch(base + route, {
          method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, duplex: 'half',
          body: new ReadableStream({ start(stream) { stream.enqueue(Buffer.alloc(32768, 32)); stream.enqueue(Buffer.alloc(32769, 32)); stream.close(); } }),
        });
        assert.equal(chunked.status, 413);
        assert.match((await chunked.json()).error, /64 KiB/);
      }
      assert.equal(calls, 0);
    });
  });

  await runTest('23 caps streamed upstream responses and cancels rejected bodies without leaking exception text', async () => {
    const { portraits, outfits } = await loadCatalog();
    const imagePayload = { imageConfig: { ...chatPayload, provider: 'openai' }, portraitId: portraits[0].id, outfitId: outfits[0].id, library: outfits[0].library, pose: 'heart' };
    for (const [route, payload, bytes] of [['/api/chat', chatPayload, 1024 ** 2], ['/api/tryon', imagePayload, 24 * 1024 ** 2]]) {
      let canceled = 0;
      let status = 200;
      await withServer(createAppServer({ fetchImpl: async () => new Response(new ReadableStream({
        start(stream) { stream.enqueue(Buffer.alloc(bytes + 1)); },
        cancel() { canceled++; },
      }), { status }) }), async (base) => {
        assert.equal((await post(base, route, payload)).status, 502);
        status = 429;
        assert.match((await (await post(base, route, payload)).json()).error, /额度|配额/);
        assert.equal(canceled, 2);
      });
    }
    await withServer(createAppServer({ fetchImpl: async () => { throw new Error('provider-private-error'); } }), async (base) => {
      const response = await post(base, '/api/tryon', imagePayload);
      assert.equal(response.status, 502);
      assert.doesNotMatch((await response.json()).error, /provider-private-error/);
    });
  });

  await runTest('24 sends two multipart inputs and verifies image signatures for both protocols', async () => {
    const { portraits, outfits } = await loadCatalog();
    const imagePayload = { imageConfig: { ...chatPayload, baseURL: 'https://api.example.com/prefix/v1/images/edits/', provider: 'openai' }, portraitId: portraits[0].id, outfitId: outfits[0].id, library: outfits[0].library, pose: 'heart' };
    let imageData = png;
    let geminiParts = [null, { inline_data: { mime_type: 'image/png', data: png } }];
    await withServer(createAppServer({ fetchImpl: async (endpoint, options) => {
      if (options.body instanceof FormData) {
        assert.equal(endpoint.pathname, '/prefix/v1/images/edits');
        assert.equal(options.body.get('model'), 'example');
        assert.equal(options.body.getAll('image[]').length, 2);
        assert.equal(options.redirect, 'error');
        return Response.json({ data: [{ b64_json: imageData }] });
      }
      return Response.json({ candidates: [{ content: { parts: geminiParts } }] });
    } }), async (base) => {
      assert.equal((await (await post(base, '/api/tryon', imagePayload)).json()).mimeType, 'image/png');
      imageData = 'aGVsbG8=';
      assert.equal((await post(base, '/api/tryon', imagePayload)).status, 502);
      imagePayload.imageConfig.provider = 'gemini';
      imagePayload.imageConfig.baseURL = 'https://api.example.com/v1beta';
      assert.equal((await post(base, '/api/tryon', imagePayload)).status, 200);
      for (const parts of [{ unexpected: true }, [{ inlineData: { mimeType: 'image/jpeg', data: png } }]]) {
        geminiParts = parts;
        assert.equal((await post(base, '/api/tryon', imagePayload)).status, 502);
      }
    });
  });

  await runTest('25 restricts paths and poses to their documented format', async () => {
    const { portraits, outfits } = await loadCatalog();
    let calls = 0;
    await withServer(createAppServer({ fetchImpl: async () => { calls++; } }), async (base) => {
      assert.equal((await fetch(base + portraits[0].image.replace('/thumbs/', '/thumbs%2F'))).status, 404);
      for (const pose of ['constructor', ['heart']]) {
        const response = await post(base, '/api/tryon', { imageConfig: { ...chatPayload, provider: 'openai' }, portraitId: portraits[0].id, outfitId: outfits[0].id, library: outfits[0].library, pose });
        assert.equal(response.status, 400);
      }
      assert.equal(calls, 0);
    });
  });
  await runTest('26 isolates WebSocket handshake headers and closes both sides on refusal and disconnect', async () => {
    let seen;
    let rejectedSocket;
    const rejectedClosed = Promise.withResolvers();
    const upgradedClosed = Promise.withResolvers();
    const backend = createServer();
    backend.on('upgrade', (req, socket) => {
      if (req.url.startsWith('/refuse/')) {
        rejectedSocket = socket;
        socket.once('close', rejectedClosed.resolve);
        socket.on('end', () => socket.destroy());
        socket.write('HTTP/1.1 403 Forbidden\r\nTransfer-Encoding: chunked\r\n\r\n');
        return;
      }
      seen = { path: req.url, origin: req.headers.origin, host: req.headers.host, cookie: req.headers.cookie, auth: req.headers.authorization };
      const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSet-Cookie: voice-test=1\r\n\r\n`);
      socket.on('error', () => {});
      socket.on('end', () => socket.destroy());
      socket.once('close', upgradedClosed.resolve);
    });
    const upgrade = (base, pathname, origin) => new Promise((resolve, reject) => {
      const req = request(new URL(pathname, base), { headers: {
        Origin: origin, Connection: 'Upgrade', Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        Cookie: 'test-session=1', Authorization: 'Bearer test-only',
      } });
      req.on('response', (res) => { res.resume(); resolve(res.statusCode); });
      req.on('upgrade', (res, socket) => {
        socket.destroy();
        if (res.headers['set-cookie']) reject(new Error('Upstream cookie crossed the proxy'));
        else resolve(res.statusCode);
      });
      req.on('error', reject);
      req.setTimeout(3000, () => req.destroy(new Error('upgrade test timed out')));
      req.end();
    });
    await withServer(backend, async (target) => {
      await withServer(createAppServer(), async (base) => {
        assert.equal(await upgrade(base, '/api/local-voice', 'https://attacker.example'), 403);
        assert.equal(await upgrade(base, '/wrong-path', base), 403);
        assert.equal(await upgrade(base, '/api/local-voice?baseURL=https://example.com', base), 400);
        assert.equal(await upgrade(base, '/api/local-voice?baseURL=http://127.0.0.1:8000/?token=secret', base), 400);
        assert.equal(seen, undefined);
        assert.equal(await upgrade(base, `/api/local-voice?baseURL=${encodeURIComponent(target)}`, base), 101);
        assert.deepEqual(seen, { path: '/api/v1/companions/voice/ws', origin: target, host: new URL(target).host, cookie: undefined, auth: undefined });
        const expectClosed = async (closed) => {
          const deadline = AbortSignal.timeout(2000);
          const result = await Promise.race([closed.then(() => true), new Promise((resolve) => deadline.addEventListener('abort', () => resolve(false), { once: true }))]);
          assert.equal(result, true, 'the upstream socket closed');
        };
        await expectClosed(upgradedClosed.promise);
        try {
          assert.equal(await upgrade(base, `/api/local-voice?baseURL=${encodeURIComponent(target + '/refuse')}`, base), 502);
          await expectClosed(rejectedClosed.promise);
        } finally {
          rejectedSocket?.destroy();
        }
      });
    });
  });
  await runTest('second 21 accepts only canonical Origin headers and rejects Host mismatches', async () => {
    let calls = 0;
    await withServer(createAppServer({ fetchImpl: async () => { calls++; return Response.json({ choices: [{ message: { content: '正常' } }] }); } }), async base => {
      for (const origin of [`${base}/`, `${base}/path`, `${base}?query=1`, `${base}#fragment`, base.replace('http://', 'http://user@'), `${base} https://other.example`, 'null']) {
        for (const route of ['/api/chat', '/api/tryon']) {
          const response = await fetch(base + route, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(chatPayload) });
          assert.equal(response.status, 403, origin);
        }
      }
      const mismatch = await rawRequest(base, '/api/chat', { Host: `localhost:${new URL(base).port}`, Origin: base, 'Content-Type': 'application/json' }, 'POST', JSON.stringify(chatPayload));
      assert.equal(mismatch.status, 403);
      assert.equal(calls, 0);
      assert.equal((await post(base, '/api/chat', chatPayload)).status, 200);
      assert.equal(calls, 1);
    });
  });

  await runTest('second 22 rejects malformed raw request targets without stopping normal requests', async () => {
    await withServer(createAppServer(), async base => {
      for (const target of ['/healthz#fragment', '/healthz?bad=%', '/healthz?bad=%G0', '//127.0.0.1/healthz', `${base}/healthz`]) {
        const response = await rawRequest(base, target);
        assert.equal(response.status, 400, target);
        assert.match(JSON.parse(response.body).error, /请求地址无效/);
      }
      assert.equal((await rawRequest(base, '/healthz?valid=%20')).status, 200);
    });
  });

  await runTest('second 23 handles scalar JSON and invalid success schemas as bounded JSON errors', async () => {
    const { portraits, outfits } = await loadCatalog();
    const imagePayload = { imageConfig: { ...chatPayload, provider: 'openai' }, portraitId: portraits[0].id, outfitId: outfits[0].id, library: outfits[0].library, pose: 'heart' };
    let upstream;
    await withServer(createAppServer({ fetchImpl: async () => new Response(JSON.stringify(upstream), { headers: { 'Content-Type': 'text/plain', 'X-Private-Debug': 'must-not-pass' } }) }), async base => {
      for (const value of [null, true, 7, 'successful-but-not-a-result', [], { choices: [{ message: { content: [] } }] }]) {
        upstream = value;
        for (const [route, payload] of [['/api/chat', chatPayload], ['/api/tryon', imagePayload]]) {
          const response = await post(base, route, payload);
          assert.equal(response.status, 502);
          assert.equal(response.headers.get('cache-control'), 'no-store');
          assert.equal(response.headers.get('x-private-debug'), null);
          assert.equal(typeof (await response.json()).error, 'string');
        }
      }
      upstream = { choices: [{ message: { content: '兼容服务' } }] };
      assert.equal((await post(base, '/api/chat', chatPayload)).status, 200, 'valid JSON remains accepted when a compatible provider labels it text/plain');
    });
  });

  await runTest('second 24 validates client and upstream WebSocket handshakes before tunneling', async () => {
    let calls = 0;
    let peer;
    const closed = Promise.withResolvers();
    const backend = createServer();
    backend.on('upgrade', (_req, socket) => {
      calls++; peer = socket;
      socket.on('error', () => {});
      socket.on('end', () => socket.destroy());
      socket.once('close', closed.resolve);
      socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: invalid-accept\r\n\r\n');
    });
    await withServer(backend, async target => {
      await withServer(createAppServer(), async base => {
        const pathname = `/api/local-voice?baseURL=${encodeURIComponent(target)}`;
        const headers = { Origin: base, Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version': '13' };
        assert.equal((await rawRequest(base, pathname, { ...headers, 'Sec-WebSocket-Version': '12' })).status, 426);
        for (const key of ['', 'not-base64', 'AAAAAAAAAAAAAAAAAAAAAB==']) assert.equal((await rawRequest(base, pathname, { ...headers, 'Sec-WebSocket-Key': key })).status, 400);
        assert.equal(calls, 0, 'invalid handshakes never reach backend');
        try {
          assert.equal((await rawRequest(base, pathname, headers)).status, 502);
          const timeout = AbortSignal.timeout(2000);
          assert.equal(await Promise.race([closed.promise.then(() => true), new Promise(resolve => timeout.addEventListener('abort', () => resolve(false), { once: true }))]), true);
          assert.equal(calls, 1);
        } finally { peer?.destroy(); }
      });
    });
  });

  await runTest('second 25 rejects zero and oversized image dimensions and broken containers', async () => {
    const { portraits, outfits } = await loadCatalog();
    const payload = { imageConfig: { ...chatPayload, provider: 'openai' }, portraitId: portraits[0].id, outfitId: outfits[0].id, library: outfits[0].library, pose: 'heart' };
    let image = png;
    const mutate = (source, change) => { const bytes = Buffer.from(source, 'base64'); change(bytes); return bytes.toString('base64'); };
    await withServer(createAppServer({ fetchImpl: async () => Response.json({ data: [{ b64_json: image }] }) }), async base => {
      for (const [valid, mime] of [[png, 'image/png'], [jpeg, 'image/jpeg'], [webp, 'image/webp'], [losslessWebp, 'image/webp'], [extendedWebp, 'image/webp']]) {
        image = valid;
        const response = await post(base, '/api/tryon', payload);
        assert.equal(response.status, 200, mime);
        assert.equal((await response.json()).mimeType, mime);
      }
      const invalid = [
        mutate(png, bytes => bytes.writeUInt32BE(0, 16)),
        mutate(png, bytes => bytes.writeUInt32BE(20000, 16)),
        mutate(png, bytes => { bytes.writeUInt32BE(10000, 16); bytes.writeUInt32BE(10000, 20); }),
        mutate(png, bytes => bytes.writeUInt32BE(0, 8)),
        Buffer.from(png, 'base64').subarray(0, 33).toString('base64'),
        mutate(jpeg, bytes => bytes.writeUInt16BE(0, bytes.indexOf(Buffer.from([0xff, 0xc0])) + 5)),
        mutate(webp, bytes => bytes.writeUInt16LE(0, 26)),
        mutate(webp, bytes => bytes.writeUInt32LE(0, 4)),
        mutate(webp, bytes => bytes.write('FAKE', 12, 'ascii')),
        mutate(losslessWebp, bytes => { bytes[24] |= 0xe0; }),
        mutate(extendedWebp, bytes => bytes.writeUIntLE(16384, 24, 3)),
      ];
      for (const value of invalid) { image = value; assert.equal((await post(base, '/api/tryon', payload)).status, 502); }
    });
  });
  console.log('All 21 local checks passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
