import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const RESOURCES = ['/', '/app.js', '/character-state.mjs', '/duplex-session.mjs', '/duplex-capture.worklet.js'];
const COMPONENTS = ['Qwen LLM', 'FunASR', 'CosyVoice TTS'];

export function localOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('invalid_local_address');
  }
  return url.origin;
}

export function portNumber(value) {
  if (!/^\d{1,5}$/.test(String(value)) || Number(value) < 1 || Number(value) > 65535)
    throw new Error('invalid_port');
  return Number(value);
}

export async function portIsFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port: portNumber(port), exclusive: true }, () => server.close(() => resolve(true)));
  });
}

async function statusOf(url, fetchImpl) {
  try {
    const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(4000), cache: 'no-store' });
    await response.body?.cancel();
    return response.status;
  } catch { return null; }
}

async function safeJSON(url, fetchImpl) {
  try {
    const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(4000), cache: 'no-store' });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      return null;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 128 * 1024) return null;
        chunks.push(chunk.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally { await reader.cancel(); }
  } catch { return null; }
}

export async function inspectPage(page = 'http://127.0.0.1:8787', fetchImpl = fetch) {
  const origin = localOrigin(page);
  const resources = await Promise.all(RESOURCES.map(async resource => ({ resource, status: await statusOf(`${origin}${resource}`, fetchImpl) })));
  return { resources, running: resources[0].status !== null, ready: resources.every(item => item.status === 200) };
}

export function inspectLocalSocket(backend, WebSocketImpl = WebSocket) {
  const url = `${localOrigin(backend).replace(/^http:/, 'ws:')}/api/v1/voice/ws`;
  return new Promise((resolve) => {
    let socket;
    let finished = false;
    const timer = setTimeout(() => finish({ ready: false, profileAware: false }), 3000);
    function finish(result) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (socket) {
        socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
        try { socket.close(); } catch { /* No raw network exceptions leave the diagnostic. */ }
      }
      resolve(result);
    }
    try {
      socket = new WebSocketImpl(url);
      socket.onopen = () => {
        // Local session negotiation only: no audio/text, provider generation, cloud connection or key.
        socket.send(JSON.stringify({ type: 'session.start', provider: 'local', codec: 'pcm_s16le', input_rate: 16000,
          character_id: 'zhixia', persona_id: 'zhixia', voice_id: 'zhixia' }));
      };
      socket.onmessage = ({ data }) => {
        if (typeof data !== 'string' || data.length > 64 * 1024) return;
        try {
          const event = JSON.parse(data);
          if (event?.type === 'session.ready') {
            finish({ ready: true, profileAware: ['character_id', 'persona_id', 'voice_id'].every(key => event[key] === 'zhixia') });
          } else if (event?.type === 'error') {
            finish({ ready: false, profileAware: false });
          }
        } catch { /* Ignore non-protocol frames without printing their contents. */ }
      };
      socket.onerror = socket.onclose = () => finish({ ready: false, profileAware: false });
    } catch { finish({ ready: false, profileAware: false }); }
  });
}

export async function inspectBackend(backend = 'http://127.0.0.1:8000', fetchImpl = fetch, WebSocketImpl = WebSocket) {
  const origin = localOrigin(backend);
  const [status, tasks, socket] = await Promise.all([
    safeJSON(`${origin}/api/v1/voice/status`, fetchImpl),
    safeJSON(`${origin}/api/v1/voice/tasks`, fetchImpl),
    inspectLocalSocket(origin, WebSocketImpl),
  ]);
  const rawComponents = Array.isArray(status?.data?.components) ? status.data.components : [];
  const components = COMPONENTS.map(name => {
    const component = rawComponents.find(item => item?.name === name);
    return { name, available: typeof component?.available === 'boolean' ? component.available : null };
  });
  return {
    statusAvailable: status?.code === 0 && Array.isArray(status?.data?.components),
    components,
    keyConfigured: typeof tasks?.data?.seeduplex_api_key_configured === 'boolean' ? tasks.data.seeduplex_api_key_configured : null,
    socket,
  };
}

export function formatPage(result) {
  const lines = result.resources.map(item => `页面资源 ${item.resource}: status=${item.status ?? 'unreachable'}`);
  if (!result.running) lines.push('页面服务未运行：请启动 start.bat。');
  else if (!result.ready) lines.push('页面模块缺失或不可用：磁盘代码已更新时，需要关闭旧页面服务窗口，再运行 start.bat；刷新浏览器不能更新旧进程的路由。');
  return lines;
}

export function formatBackend(result) {
  const lines = [`后端健康 API: available=${result.statusAvailable}`,
    ...result.components.map(item => `${item.name}: available=${item.available ?? 'unknown'}`),
    `SeedDuplex 服务端 Key: configured=${result.keyConfigured ?? 'unknown'}`,
    `本地 WebSocket: ready=${result.socket.ready} profile_aware=${result.socket.profileAware}`];
  if (!result.statusAvailable) lines.push('后端不可用：请运行 start-voice-backend.bat，或检查本机端口。');
  if (result.components.some(item => item.available === false)) lines.push('缺少本地模型服务：请分别启动 Qwen、FunASR、CosyVoice；启动 Go 后端不会自动启动模型。');
  if (result.keyConfigured === false) lines.push('未配置服务端 SeedDuplex Key；使用豆包前需在当前浏览器设置 Key 或配置后端进程环境。未读取浏览器 Key，本地语音不受影响。');
  if (result.socket.ready && !result.socket.profileAware) lines.push('检测到旧后端：本地模型健康不代表新版角色/语音协议已加载，请关闭旧后端窗口后重新启动。');
  if (!result.socket.ready) lines.push('本地 WebSocket 协商失败：请检查或重启后端；本次未发送音频、聊天或付费请求。');
  return lines;
}

function openBrowser(url) {
  if (process.platform !== 'win32') return;
  const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', `${localOrigin(url)}/`], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
}

export async function runCLI(args = process.argv.slice(2), output = console.log) {
  try {
    if (args[0] === '--runtime') {
      const supported = Number(process.versions.node.split('.')[0]) >= 24 && process.allowedNodeEnvironmentFlags.has('--use-env-proxy');
      output(`Node.js 24+ env-proxy support: ${supported}`);
      return supported ? 0 : 2;
    }
    if (args[0] === '--port-free') {
      const port = portNumber(args[1]);
      const free = await portIsFree(port);
      output(`本机端口 ${port}: ${free ? 'free' : 'occupied'}。不会停止占用端口的进程。`);
      return free ? 0 : 1;
    }
    const pageIndex = args.indexOf('--page');
    const backendIndex = args.indexOf('--backend');
    const page = localOrigin(pageIndex >= 0 ? args[pageIndex + 1] : 'http://127.0.0.1:8787');
    const backend = localOrigin(backendIndex >= 0 ? args[backendIndex + 1] : 'http://127.0.0.1:8000');
    if (args.includes('--wait-page')) {
      let result;
      for (let attempt = 0; attempt < 20; attempt++) {
        result = await inspectPage(page);
        if (result.ready) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      formatPage(result).forEach(line => output(line));
      if (result.ready && args.includes('--open')) openBrowser(page);
      return result.ready ? 0 : 1;
    }
    output('只检查本机状态，不打印配置/聊天/Key，不发送付费请求。');
    let healthy = true;
    if (!args.includes('--backend-only')) {
      const result = await inspectPage(page);
      formatPage(result).forEach(line => output(line));
      healthy &&= result.ready;
    }
    if (!args.includes('--page-only')) {
      const result = await inspectBackend(backend);
      formatBackend(result).forEach(line => output(line));
      healthy &&= result.statusAvailable && result.socket.ready && result.socket.profileAware && result.components.every(item => item.available === true);
    }
    return healthy ? 0 : 1;
  } catch {
    output('诊断参数或运行环境无效。仅允许 http://localhost、http://127.0.0.1 或 IPv6 回环地址；Node.js 24+ 必需。');
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCLI();
}
