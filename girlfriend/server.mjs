import { createServer, request as httpRequest } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { CHARACTERS, POSES as CHARACTER_POSES } from '../app/src/composables/character/character-state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, '..');
const SYSTEM_PROMPT = `你叫知夏，是一位温柔、自然、有自己见解的 AI 虚拟陪伴角色。请用中文交流，像熟悉的亲密朋友一样温暖、真诚地回应，记得认真接住对方刚才说的话，多交流、少说教。可以适度俏皮，但不编造现实生活经历，不假装自己是真人或取代用户现实中的关系；用户不舒服时尊重边界。不要声称自己能提供专业医疗、心理或法律服务；遇到紧急危险，温和建议联系现实中可信任的人或当地紧急服务。回复简洁、口语化，有需要时温柔提问。`;
const STATIC_FILES = new Map([
  ['/', [path.join(HERE, 'index.html'), 'text/html; charset=utf-8']],
  ['/styles.css', [path.join(HERE, 'styles.css'), 'text/css; charset=utf-8']],
  ['/app.js', [path.join(HERE, 'app.js'), 'text/javascript; charset=utf-8']],
  ['/character-state.mjs', [path.join(PROJECT_ROOT, 'app/src/composables/character/character-state.mjs'), 'text/javascript; charset=utf-8']],
  ['/duplex-session.mjs', [path.join(HERE, 'duplex-session.mjs'), 'text/javascript; charset=utf-8']],
  ['/duplex-capture.worklet.js', [path.join(PROJECT_ROOT, 'app/src/composables/voice/worklets/pcm-capture.worklet.js'), 'text/javascript; charset=utf-8']],
]);
const MAX_BODY_BYTES = 64 * 1024;
const MAX_CHAT_RESPONSE_BYTES = 1024 * 1024;
const MAX_IMAGE_RESPONSE_BYTES = 24 * 1024 * 1024;
class BodyTooLarge extends Error {}
class ImageResponseError extends Error {}
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const POSES = Object.freeze({
  natural: 'standing naturally, one hand resting softly by her side, warm gentle expression',
  wave: 'standing and giving a small friendly wave with one hand, warm smiling expression',
  heart: 'standing and forming a small heart gesture with both hands near her chest',
  peace: 'standing and making a cute peace sign beside her face, cheerful but natural',
  sitting: 'sitting gracefully with a relaxed posture, hands resting naturally, looking toward camera',
  profile: 'standing in a relaxed three-quarter profile, gently looking back toward camera',
});
const MIME_TYPES = new Map([['.webp', 'image/webp'], ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg']]);
let catalogPromise;

async function parseBundledArray(filename, variableName) {
  const source = await readFile(path.join(PROJECT_ROOT, filename), 'utf8');
  const line = source.split(/\r?\n/).find((item) => new RegExp(`^const\\s+${variableName}\\s*=`).test(item));
  if (!line) throw new Error('图库索引不可用。');
  const value = line.slice(line.indexOf('=') + 1).trim().replace(/;\s*$/, '');
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error('图库索引格式无效。');
  return parsed;
}

export async function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = Promise.all([
      parseBundledArray('data-portrait.js', 'D_PORTRAIT'),
      parseBundledArray('data.js', 'D'),
      parseBundledArray('data-anime.js', 'D_ANIME'),
    ]).then(([portraits, outfits, anime]) => {
      const picture = (item) => typeof item['サムネ'] === 'string' ? item['サムネ'] : item['画像'];
      const validThumb = (value, prefix) => typeof value === 'string' &&
        value.startsWith(prefix) && /^[a-zA-Z0-9_./-]+\.webp$/.test(value) && !value.includes('..');
      const portraitRows = portraits
        .filter((item) => typeof item.id === 'string' && /^[a-f0-9]{6,24}$/i.test(item.id) && validThumb(picture(item), 'portrait/thumbs/'))
        .map((item) => ({
          id: item.id,
          section: item.sec === 'styling' ? 'styling' : 'face',
          label: item.secZh || (item.sec === 'styling' ? '全身造型' : '人像'),
          hair: item.hairZh || '',
          style: item.styleZh || '',
          keywords: String(item['キーワード'] || '').slice(0, 240),
          image: `/assets/${picture(item)}`,
        }));
      const outfitRows = [...outfits.map((item) => ({ ...item, library: 'real' })), ...anime.map((item) => ({ ...item, library: 'anime' }))]
        .filter((item) => typeof item.id === 'string' && /^[A-Z0-9-]{3,40}$/i.test(item.id) && validThumb(picture(item), item.library === 'anime' ? 'anime/' : ''))
        .map((item) => ({
          id: item.id,
          library: item.library,
          category: String(item['カテゴリ'] || ''),
          keywords: String(item['キーワード'] || '').slice(0, 240),
          image: `/assets/${picture(item)}`,
        }));
      return {
        portraits: portraitRows,
        outfits: outfitRows,
        poses: CHARACTER_POSES.map(({ id, label }) => ({ id, label, prompt: POSES[id] })),
      };
    }).catch((error) => {
      catalogPromise = null;
      throw error;
    });
  }
  return catalogPromise;
}

export function buildCompletionURL(baseURL) {
  if (typeof baseURL !== 'string' || baseURL.length > 2048) {
    throw new Error('API Base URL 无效。');
  }
  let url;
  try {
    url = new URL(baseURL.trim());
  } catch {
    throw new Error('请填写有效的 API Base URL。');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Base URL 不能包含账号、密码、查询参数或片段。');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) {
    throw new Error('外部 API 必须使用 HTTPS；HTTP 仅允许本机回环地址。');
  }
  const basePath = url.pathname.replace(/\/+$/, '');
  url.pathname = basePath.endsWith('/chat/completions') ? basePath : `${basePath}/chat/completions`;
  return url;
}

function reply(res, status, body, headers = {}) {
  if (res.destroyed) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function originIsLocalAndSame(req) {
  const host = req.headers.host;
  const originHeader = req.headers.origin;
  if (typeof host !== 'string' || typeof originHeader !== 'string') return false;
  try {
    const origin = new URL(originHeader);
    return origin.protocol === 'http:' && originHeader === origin.origin &&
      LOCAL_HOSTS.has(origin.hostname) &&
      origin.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

async function readJSON(req) {
  const tooLarge = () => new BodyTooLarge('请求内容超过 64 KiB，请减少内容后重试。');
  if (Number(req.headers['content-length']) > MAX_BODY_BYTES) throw tooLarge();
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw tooLarge();
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('请求格式无效，请重新发送。');
  }
}

function replyInputError(req, res, error) {
  if (error instanceof BodyTooLarge) {
    reply(res, 413, { error: error.message }, { Connection: 'close' });
    req.resume();
  } else {
    reply(res, 400, { error: error.message });
  }
}

function upstreamLifetime(res, milliseconds) {
  const controller = new AbortController();
  const disconnect = () => { if (!res.writableFinished) controller.abort(); };
  const timeout = setTimeout(() => controller.abort(), milliseconds);
  res.once('close', disconnect);
  if (res.destroyed) disconnect();
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout);
      res.off('close', disconnect);
    },
  };
}

async function readUpstreamJSON(response, limit) {
  if (!response.body) throw new Error('模型服务没有返回响应内容。');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('模型服务响应超过允许大小。');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function validateChatPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('请求内容无效。');
  }
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const model = typeof body.model === 'string' ? body.model.trim() : '';
  if (!apiKey || apiKey.length > 2048) throw new Error('请先在设置中填写有效的 API Key。');
  if (!model || model.length > 120) throw new Error('请在设置中填写有效的模型名称。');
  const endpoint = buildCompletionURL(body.baseURL);
  if (!Array.isArray(body.messages) || body.messages.length > 24) {
    throw new Error('对话内容无效，请开启新对话后重试。');
  }
  const messages = body.messages.map((item) => {
    if (!item || !['user', 'assistant'].includes(item.role) ||
        typeof item.content !== 'string' || !item.content.trim() || item.content.length > 4000) {
      throw new Error('对话内容无效，请检查消息后重试。');
    }
    return { role: item.role, content: item.content };
  });
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    throw new Error('请先发送一条消息。');
  }
  const characterId = body.characterId === undefined ? 'zhixia' : body.characterId;
  if (!CHARACTERS.some(item => item.id === characterId)) throw new Error('请选择清单中的角色。');
  return { apiKey, model, endpoint, messages, characterId };
}

async function handleChat(req, res, fetchImpl) {
  if (!originIsLocalAndSame(req)) {
    reply(res, 403, { error: '仅允许从本机聊天页面发送请求。' });
    return;
  }
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    reply(res, 415, { error: '请求内容类型无效。' });
    return;
  }

  let payload;
  try {
    payload = validateChatPayload(await readJSON(req));
  } catch (error) {
    replyInputError(req, res, error);
    return;
  }

  // Credentials and messages exist only in memory for this request. Never log or persist them.
  const { signal, dispose } = upstreamLifetime(res, 120_000);
  try {
    signal.throwIfAborted();
    const upstream = await fetchImpl(payload.endpoint, {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: {
        'Authorization': `Bearer ${payload.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        model: payload.model,
        messages: [{ role: 'system', content: payload.characterId === 'linxi'
           ? SYSTEM_PROMPT.replace('你叫知夏，是一位温柔、自然、有自己见解的 AI 虚拟陪伴角色。请用中文交流，像熟悉的亲密朋友一样温暖、真诚地回应，记得认真接住对方刚才说的话，多交流、少说教。', '你叫林溪，是一位明快、坦率、略带幽默的 AI 虚拟陪伴角色。请用中文简洁回应，主动提问，给出具体的小建议，但不替用户做主。')
           : SYSTEM_PROMPT }, ...payload.messages],
        stream: false,
      }),
    });
    if (!upstream.ok) {
      void upstream.body?.cancel().catch(() => {});
      const hints = {
        401: 'API Key 未通过服务商验证，请检查 Key 是否正确。',
        403: '当前 Key 没有访问该模型的权限。',
        404: '找不到这个模型或接口，请检查模型名称与 Base URL。',
        429: '模型服务暂时繁忙或额度不足，请稍后再试。',
      };
      reply(res, 502, { error: hints[upstream.status] || `模型服务返回错误（HTTP ${upstream.status}），请检查模型配置。` });
      return;
    }
    let result;
    try {
      result = await readUpstreamJSON(upstream, MAX_CHAT_RESPONSE_BYTES);
    } catch (error) {
      if (signal.aborted) throw error;
      reply(res, 502, { error: '模型服务返回了无法读取的响应，请检查 Base URL。' });
      return;
    }
    const content = result?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      reply(res, 502, { error: '模型没有返回文字回复；请确认所选模型支持聊天接口。' });
      return;
    }
    reply(res, 200, { reply: content.slice(0, 20_000) });
  } catch (error) {
    if (!res.headersSent) {
      reply(res, 502, {
        error: signal.aborted
          ? '请求超时或已取消，请确认服务可访问后重试。'
          : '无法连接模型服务，请检查 Base URL 与网络后重试。',
      });
    }
  } finally {
    dispose();
  }
}

function validateImageConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请先在设置中填写图片模型配置。');
  const provider = typeof value.provider === 'string' ? value.provider.trim().toLowerCase() : '';
  const apiKey = typeof value.apiKey === 'string' ? value.apiKey.trim() : '';
  const model = typeof value.model === 'string' ? value.model.trim() : '';
  if (!['gemini', 'openai'].includes(provider)) throw new Error('请选择 Gemini 或 OpenAI Images 兼容协议。');
  if (!apiKey || apiKey.length > 2048) throw new Error('请填写有效的图片模型 API Key。');
  if (!model || model.length > 120 || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(model)) throw new Error('请填写有效的图片模型名称。');
  if (typeof value.baseURL !== 'string' || value.baseURL.length > 2048) throw new Error('图片模型服务地址无效。');
  let baseURL;
  try {
    baseURL = new URL(value.baseURL.trim());
  } catch {
    throw new Error('请填写有效的图片模型服务地址。');
  }
  if (baseURL.username || baseURL.password || baseURL.search || baseURL.hash) throw new Error('图片模型 Base URL 不能包含账号、密码、查询参数或片段。');
  if (baseURL.protocol !== 'https:' && !(baseURL.protocol === 'http:' && LOCAL_HOSTS.has(baseURL.hostname))) {
    throw new Error('图片模型服务必须使用 HTTPS；HTTP 仅允许本机回环地址。');
  }
  return { provider, apiKey, model, baseURL };
}

function buildProviderEndpoint(baseURL, pathSuffix) {
  const endpoint = new URL(baseURL);
  const basePath = endpoint.pathname.replace(/\/+$/, '');
  endpoint.pathname = basePath.endsWith(`/${pathSuffix}`) ? basePath : `${basePath}/${pathSuffix}`;
  return endpoint;
}

async function readCatalogImage(relativePath) {
  const assetsRoot = path.resolve(PROJECT_ROOT, 'assets');
  if (!/^[A-Za-z0-9_./-]+\.webp$/.test(relativePath) || relativePath.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('图库图片路径无效。');
  }
  const filePath = path.resolve(assetsRoot, relativePath);
  if (!filePath.startsWith(`${assetsRoot}${path.sep}`)) throw new Error('图库图片路径无效。');
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES.get(ext);
  if (ext !== '.webp' || !mimeType) throw new Error('图库图片格式不受支持。');
  const maxBytes = 8 * 1024 * 1024;
  if ((await stat(filePath)).size > maxBytes) throw new Error('图库图片超过允许大小。');
  const data = await readFile(filePath);
  if (data.length > maxBytes) throw new Error('图库图片超过允许大小。');
  const dimensions = data.length >= 20 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP'
    ? imageDimensions(data, mimeType) : null;
  if (!dimensions || dimensions.some(value => value < 1 || value > 8192) || dimensions[0] * dimensions[1] > 20_000_000)
    throw new Error('图库图片尺寸或文件头无效。');
  return { data, mimeType };
}

function buildCompanionPrompt(pose, library) {
  const style = library === 'anime'
    ? 'Create a polished high-quality 2D Japanese anime illustration with clean linework and soft romantic colors.'
    : 'Create a polished, realistic fashion portrait with natural lighting and refined editorial styling.';
  return `Create one finished full-body portrait of a fictional adult woman AI companion. ${style}\n\nReference image 1 supplies only her adult facial identity, face shape, facial features, skin tone and hairstyle. Keep those recognizable. Do not copy reference image 1 clothing, framing, background or pose. Reference image 2 supplies the exact clothing design and accessories. Recreate its colors, silhouette, fabric, neckline, sleeves, patterns and modest styling faithfully; do not reuse any mannequin or person shown on the clothing reference.\n\nPose and expression: ${pose}. Show the whole adult character clearly from head to shoes, both arms and legs anatomically natural, one person only, clean softly colored studio background, no text, no watermark, fully clothed.`;
}

function imageDimensions(bytes, mimeType) {
  if (mimeType === 'image/png') {
    if (bytes.readUInt32BE(8) !== 13 || bytes.length < 45 || bytes.readUInt32BE(bytes.length - 12) !== 0 || bytes.toString('hex', bytes.length - 8) !== '49454e44ae426082') return null;
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  if (mimeType === 'image/webp') {
    if (bytes.readUInt32LE(4) + 8 !== bytes.length || bytes.readUInt32LE(16) + 20 > bytes.length) return null;
    const kind = bytes.toString('ascii', 12, 16);
    if (kind === 'VP8X' && bytes.length >= 30 && bytes.readUInt32LE(16) === 10) return [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1];
    if (kind === 'VP8L' && bytes.length >= 25 && bytes.readUInt32LE(16) >= 5 && bytes[20] === 0x2f && (bytes[24] >> 5) === 0) {
      const packed = bytes.readUInt32LE(21);
      return [(packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1];
    }
    if (kind === 'VP8 ' && bytes.length >= 30 && bytes.readUInt32LE(16) >= 10 && !(bytes[20] & 1) && bytes.toString('hex', 23, 26) === '9d012a') return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
    return null;
  }
  let offset = 2;
  let dimensions;
  while (offset < bytes.length - 2) {
    if (bytes[offset++] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (marker === 0xda) return length >= 6 ? dimensions : null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8 || length !== 8 + 3 * bytes[offset + 7]) return null;
      dimensions = [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
    }
    offset += length;
  }
  return null;
}

function validatedImage(data, declaredMime) {
  if (typeof data !== 'string' || data.length < 12 || data.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return null;
  const bytes = Buffer.from(data, 'base64');
  if (bytes.toString('base64').replace(/=+$/, '') !== data.replace(/=+$/, '') || (data.includes('=') && data.length % 4 !== 0)) return null;
  let mimeType;
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && bytes.toString('ascii', 12, 16) === 'IHDR') mimeType = 'image/png';
  else if (bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) mimeType = 'image/jpeg';
  else if (bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') mimeType = 'image/webp';
  if (!mimeType || (declaredMime && declaredMime !== mimeType)) return null;
  const dimensions = imageDimensions(bytes, mimeType);
  if (!dimensions || dimensions.some((value) => value < 1 || value > 16384) || dimensions[0] * dimensions[1] > 64 * 1024 * 1024) return null;
  return { data, mimeType };
}

function extractGeminiImage(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    const inline = part?.inlineData || part?.inline_data;
    const mimeType = inline?.mimeType || inline?.mime_type;
    if (typeof mimeType !== 'string') continue;
    const image = validatedImage(inline?.data, mimeType);
    if (image) return image;
  }
  return null;
}

async function readImageResponse(response) {
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new ImageResponseError(imageServiceMessage(response.status));
  }
  return readUpstreamJSON(response, MAX_IMAGE_RESPONSE_BYTES);
}

async function generateWithGemini(fetchImpl, config, prompt, person, garment, signal) {
  const endpoint = buildProviderEndpoint(config.baseURL, `models/${encodeURIComponent(config.model)}:generateContent`);
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    redirect: 'error',
    signal,
    headers: { 'x-goog-api-key': config.apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [
        { text: prompt },
        { inlineData: { mimeType: person.mimeType, data: person.data.toString('base64') } },
        { inlineData: { mimeType: garment.mimeType, data: garment.data.toString('base64') } },
      ] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    }),
  });
  const result = await readImageResponse(response);
  const image = extractGeminiImage(result);
  if (!image) throw new ImageResponseError('图片模型未返回图片；请确认它支持图像生成/编辑，并启用了对应配额。');
  return image;
}

async function generateWithOpenAI(fetchImpl, config, prompt, person, garment, signal) {
  const endpoint = buildProviderEndpoint(config.baseURL, 'images/edits');
  const form = new FormData();
  form.set('model', config.model);
  form.set('prompt', prompt);
  form.set('size', '1024x1536');
  form.set('n', '1');
  form.append('image[]', new Blob([person.data], { type: person.mimeType }), `portrait.${person.mimeType === 'image/webp' ? 'webp' : 'png'}`);
  form.append('image[]', new Blob([garment.data], { type: garment.mimeType }), `outfit.${garment.mimeType === 'image/webp' ? 'webp' : 'png'}`);
  const response = await fetchImpl(endpoint, {
    method: 'POST', redirect: 'error', signal,
    headers: { 'Authorization': `Bearer ${config.apiKey}`, 'Accept': 'application/json' },
    body: form,
  });
  const result = await readImageResponse(response);
  const image = validatedImage(result?.data?.[0]?.b64_json);
  if (!image) throw new ImageResponseError('图片模型未返回有效图片；请确认所选模型支持 Images Edits。');
  return image;
}

function imageServiceMessage(status) {
  const messages = {
    400: '图片模型拒绝了这次编辑请求，请确认模型支持多图编辑或试试 Gemini 图像模型。',
    401: '图片 API Key 未通过验证，请检查模型设置。',
    403: '当前图片 Key 没有访问该图像模型的权限。',
    404: '没有找到该图像模型或图像编辑接口，请检查模型名和 Base URL。',
    429: '图片模型暂时繁忙或配额不足，请稍后再试。',
  };
  return messages[status] || `图片服务返回错误（HTTP ${status}）。`;
}

async function handleTryOn(req, res, fetchImpl) {
  if (!originIsLocalAndSame(req)) {
    reply(res, 403, { error: '仅允许从本机形象工作室发送请求。' });
    return;
  }
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    reply(res, 415, { error: '请求内容类型无效。' });
    return;
  }
  let body;
  let imageConfig;
  let person;
  let garment;
  let poseId;
  try {
    body = await readJSON(req);
    imageConfig = validateImageConfig(body?.imageConfig);
    const catalog = await loadCatalog();
    const portrait = catalog.portraits.find((item) => item.id === body.portraitId);
    const outfit = catalog.outfits.find((item) => item.id === body.outfitId && item.library === body.library);
    if (!portrait) throw new Error('请从本地模特图库选择有效头像。');
    if (!outfit) throw new Error('请从本地服装图库选择有效服装。');
    poseId = body.pose_id === undefined ? body.pose : body.pose_id;
    if (typeof poseId !== 'string' || !Object.hasOwn(POSES, poseId) || (body.pose !== undefined && body.pose !== poseId))
      throw new Error('请选择有效的角色姿势。');
    person = await readCatalogImage(portrait.image.replace(/^\/assets\//, ''));
    garment = await readCatalogImage(outfit.image.replace(/^\/assets\//, ''));
  } catch (error) {
    replyInputError(req, res, error);
    return;
  }

  const { signal, dispose } = upstreamLifetime(res, 180_000);
  try {
    signal.throwIfAborted();
    const prompt = buildCompanionPrompt(POSES[poseId], body.library);
    const result = imageConfig.provider === 'gemini'
      ? await generateWithGemini(fetchImpl, imageConfig, prompt, person, garment, signal)
      : await generateWithOpenAI(fetchImpl, imageConfig, prompt, person, garment, signal);
    reply(res, 200, { mimeType: result.mimeType, image: result.data, pose: poseId, outfitId: body.outfitId });
  } catch (error) {
    if (!res.headersSent) reply(res, 502, { error: signal.aborted ? '图片生成超时或已取消，请稍后重试。' : (error instanceof ImageResponseError ? error.message : '图片生成失败，请检查图片模型设置。') });
  } finally {
    dispose();
  }
}

export function buildLocalVoiceURL(baseURL) {
  if (typeof baseURL !== 'string' || baseURL.length > 2048) throw new Error('本地语音后端地址无效。');
  let url;
  try { url = new URL(baseURL.trim()); } catch { throw new Error('请填写有效的本地语音后端地址。'); }
  if (url.protocol !== 'http:' || !LOCAL_HOSTS.has(url.hostname) || url.username || url.password || url.search || url.hash) {
    throw new Error('本地语音后端仅允许无凭据的 HTTP 回环地址。');
  }
  return buildProviderEndpoint(url, 'api/v1/companions/voice/ws');
}

function healthRequestIsSameOrigin(req) {
  if (req.headers['x-companion-request'] !== 'voice-health') return false;
  if (req.headers.origin !== undefined) return originIsLocalAndSame(req);
  if (req.headers['sec-fetch-site'] !== 'same-origin' || typeof req.headers.host !== 'string') return false;
  try {
    const address = new URL(`http://${req.headers.host}`);
    return LOCAL_HOSTS.has(address.hostname) && address.host.toLowerCase() === req.headers.host.toLowerCase()
      && !address.username && !address.password && address.pathname === '/' && !address.search && !address.hash;
  } catch { return false; }
}

async function handleLocalVoiceHealth(req, res, url, fetchImpl) {
  if (!healthRequestIsSameOrigin(req)) { reply(res, 403, { error: '仅允许从本机同源页面检查语音连接。' }); return; }
  let base;
  try {
    if (url.searchParams.getAll('baseURL').length !== 1 || [...url.searchParams.keys()].some(key => key !== 'baseURL')) throw new Error('invalid query');
    base = buildLocalVoiceURL(url.searchParams.get('baseURL'));
  } catch { reply(res, 400, { error: '请填写无凭据的本机 HTTP 回环后端地址。' }); return; }
  const { signal, dispose } = upstreamLifetime(res, 5000);
  const read = async (pathname) => {
    const endpoint = new URL(base.origin);
    endpoint.pathname = pathname;
    const response = await fetchImpl(endpoint, { method: 'GET', redirect: 'error', signal, credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok || Number(response.headers?.get('content-length')) > 32 * 1024) {
      void response.body?.cancel().catch(() => {});
      throw new Error('invalid health response');
    }
    const value = await readUpstreamJSON(response, 32 * 1024);
    if (!value || value.code !== 0 || !value.data || typeof value.data !== 'object' || Array.isArray(value.data)) throw new Error('invalid health schema');
    return value.data;
  };
  try {
    const [status, tasks] = await Promise.allSettled([read('/api/v1/voice/status'), read('/api/v1/voice/tasks')]);
    const components = status.status === 'fulfilled' && Array.isArray(status.value.components) ? status.value.components : null;
    const available = name => Boolean(components?.some(item => item && item.name === name && item.available === true));
    const seedKeyConfigured = tasks.status === 'fulfilled' && typeof tasks.value.seeduplex_api_key_configured === 'boolean' ? tasks.value.seeduplex_api_key_configured : null;
    reply(res, components ? 200 : 503, {
      backendAvailable: Boolean(components),
      models: { qwen: { available: available('Qwen LLM') }, funasr: { available: available('FunASR') }, cosyvoice: { available: available('CosyVoice TTS') } },
      seedKeyConfigured,
    });
  } finally { dispose(); }
}

function requestURL(req) {
  if (!req.url?.startsWith('/') || req.url.startsWith('//') || req.url.includes('\\') || req.url.includes('#') || /%(?![0-9a-f]{2})/i.test(req.url)) return null;
  try { return new URL(req.url, 'http://localhost'); } catch { return null; }
}

export function createAppServer({ fetchImpl = globalThis.fetch } = {}) {
  const server = createServer(async (req, res) => {
    const url = requestURL(req);
    if (!url) { reply(res, 400, { error: '请求地址无效。' }); return; }
    if (req.method === 'GET' && url.pathname === '/healthz') {
      reply(res, 200, { ok: true });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/local-voice-health') {
      await handleLocalVoiceHealth(req, res, url, fetchImpl);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/catalog') {
      try {
        const catalog = await loadCatalog();
        reply(res, 200, catalog, { 'Cache-Control': 'no-store' });
      } catch {
        reply(res, 500, { error: '本地头像与服装图库暂时无法读取。' });
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      await handleChat(req, res, fetchImpl);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/tryon') {
      await handleTryOn(req, res, fetchImpl);
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
      try {
        const relative = url.pathname.slice('/assets/'.length);
        const image = await readCatalogImage(relative);
        res.writeHead(200, {
          'Content-Type': image.mimeType,
          'Cache-Control': 'public, max-age=604800, immutable',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; img-src 'self'; sandbox",
        });
        res.end(image.data);
      } catch {
        reply(res, 404, { error: '没有找到这张本地图集图片。' });
      }
      return;
    }
    if (req.method === 'GET' && STATIC_FILES.has(url.pathname)) {
      const [filename, contentType] = STATIC_FILES.get(url.pathname);
      try {
        const contents = await readFile(filename);
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Permissions-Policy': 'camera=(), microphone=(self), geolocation=()',
        });
        res.end(contents);
      } catch {
        reply(res, 500, { error: '页面文件暂时无法读取。' });
      }
      return;
    }
    reply(res, 404, { error: '未找到该页面。' });
  });
  server.on('upgrade', (req, clientSocket, head) => {
    clientSocket.on('error', () => clientSocket.destroy());
    const url = requestURL(req);
    if (url?.pathname !== '/api/local-voice' || req.method !== 'GET' || req.headers.upgrade?.toLowerCase() !== 'websocket' || !originIsLocalAndSame(req)) {
      clientSocket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const key = req.headers['sec-websocket-key'];
    if (req.headers['sec-websocket-version'] !== '13') {
      clientSocket.end('HTTP/1.1 426 Upgrade Required\r\nSec-WebSocket-Version: 13\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    if (typeof key !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(key) || Buffer.from(key, 'base64').toString('base64') !== key) {
      clientSocket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    let target;
    try {
      target = buildLocalVoiceURL(url.searchParams.get('baseURL') || 'http://127.0.0.1:8000');
    } catch {
      clientSocket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const handshakeHeaders = ['sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol', 'sec-websocket-extensions'];
    const headers = Object.fromEntries(handshakeHeaders.filter((key) => req.headers[key]).map((key) => [key, req.headers[key]]));
    const upstream = httpRequest({
      hostname: target.hostname.replace(/^\[|\]$/g, ''),
      agent: false,
      port: target.port || 80,
      path: target.pathname,
      method: 'GET',
      headers: {
        ...headers,
        host: target.host,
        origin: target.origin,
        connection: 'Upgrade',
        upgrade: 'websocket',
      },
    });
    let peer;
    const timeout = setTimeout(() => upstream.destroy(), 15000);
    clientSocket.once('close', () => {
      clearTimeout(timeout);
      upstream.destroy();
      peer?.destroy();
    });
    upstream.on('upgrade', (response, upstreamSocket, upstreamHead) => {
      clearTimeout(timeout);
      peer = upstreamSocket;
      if (clientSocket.destroyed) { peer.destroy(); return; }
      const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      if (response.statusCode !== 101 || response.headers.upgrade?.toLowerCase() !== 'websocket' || response.headers['sec-websocket-accept'] !== accept) {
        peer.destroy();
        badGateway();
        return;
      }
      peer.once('close', () => clientSocket.destroy());
      peer.on('error', () => peer.destroy());
      const responseHeaders = ['upgrade', 'connection', 'sec-websocket-accept', 'sec-websocket-protocol', 'sec-websocket-extensions']
        .filter((key) => response.headers[key])
        .map((key) => `${key}: ${response.headers[key]}`)
        .join('\r\n');
      clientSocket.write(`HTTP/1.1 101 Switching Protocols\r\n${responseHeaders}\r\n\r\n`);
      if (upstreamHead.length) clientSocket.write(upstreamHead);
      if (head.length) peer.write(head);
      peer.pipe(clientSocket).pipe(peer);
    });
    const badGateway = () => {
      clearTimeout(timeout);
      if (!clientSocket.destroyed) clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    };
    upstream.on('response', (response) => {
      response.destroy();
      badGateway();
    });
    upstream.on('error', badGateway);
    upstream.end();
  });
  return server;
}

function parsePort(value) {
  const port = Number(value || 8787);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('PORT 必须是 1024 至 65535 之间的整数。');
  }
  return port;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  const port = parsePort(process.env.PORT);
  const server = createAppServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`知夏已启动：http://127.0.0.1:${port}`);
    console.log('服务仅监听本机回环地址；不会输出或保存 API Key 与对话内容。');
  });
}
