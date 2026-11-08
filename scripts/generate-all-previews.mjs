import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const CHROME_PATH = 'C:\\Users\\Administrator\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
const TEMP_DIR = 'C:\\Users\\Administrator\\AppData\\Local\\Temp\\chrome-shot-all'
const H5_DIR = path.resolve('app/dist/build/h5')
const DOCS_DIR = path.resolve('docs')
const PORT = 9005
const BACKEND_URL = 'http://127.0.0.1:8000'

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

class CDPClient {
  constructor(ws) {
    this.ws = ws
    this.id = 1
    this.callbacks = new Map()
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id)
        this.callbacks.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      }
    }
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++
      this.callbacks.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
}

async function main() {
  if (!fs.existsSync(DOCS_DIR)) {
    fs.mkdirSync(DOCS_DIR, { recursive: true })
  }

  // 1. 启动静态服务 + API 代理
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', '*')
    res.setHeader('Access-Control-Allow-Headers', '*')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const urlObj = new URL(req.url, `http://localhost:${PORT}`)
    let pathname = decodeURIComponent(urlObj.pathname)

    if (pathname.startsWith('/api/')) {
      const backendReq = http.request(`${BACKEND_URL}${req.url}`, {
        method: req.method,
        headers: { ...req.headers, host: '127.0.0.1:8000' },
      }, (backendRes) => {
        res.writeHead(backendRes.statusCode || 200, backendRes.headers)
        backendRes.pipe(res)
      })
      backendReq.on('error', (err) => {
        res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      })
      req.pipe(backendReq)
      return
    }

    let filePath = path.join(H5_DIR, pathname)
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html')
    }
    if (!fs.existsSync(filePath)) {
      filePath = path.join(H5_DIR, 'index.html')
    }
    const ext = path.extname(filePath).toLowerCase()
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404)
        res.end('Not Found')
        return
      }
      res.writeHead(200, { 'Content-Type': contentType })
      res.end(data)
    })
  })

  await new Promise(r => server.listen(PORT, '127.0.0.1', r))
  console.log('Preview HTTP Server listening on port', PORT)

  // 2. 启动 Headless Chrome
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true })
  }
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--hide-scrollbars',
    '--remote-debugging-port=9222',
    `--user-data-dir=${TEMP_DIR}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' })

  await new Promise(r => setTimeout(r, 1200))

  const tasks = [
    {
      name: 'preview-1-home.png',
      title: '首页发现 · 双图库与二次元穿搭橱窗',
      url: `http://127.0.0.1:${PORT}/#/pages/index/index`,
      setup: async (client) => {
        await new Promise(r => setTimeout(r, 2500))
      },
    },
    {
      name: 'preview-2-anime.png',
      title: '图库专区 · 1320套二次元动漫服饰与风格筛选',
      url: `http://127.0.0.1:${PORT}/#/pages/gallery/index`,
      setup: async (client) => {
        // 先设置 preferred_lib 为 anime 并触发页面刷新
        await client.send('Runtime.evaluate', {
          expression: `
            localStorage.setItem('nvzhuang:gallery:preferred_lib', 'anime');
            location.reload();
          `,
        })
        await new Promise(r => setTimeout(r, 3000))
      },
    },
    {
      name: 'preview-3-tryon.png',
      title: 'AI 虚拟试衣间 · 模特服装配置与二次元引导',
      url: `http://127.0.0.1:${PORT}/#/pages/tryon/index`,
      setup: async (client) => {
        await new Promise(r => setTimeout(r, 2000))
        await client.send('Runtime.evaluate', {
          expression: `(() => {
            const appEl = document.querySelector('#app');
            const vueApp = appEl?.__vue_app__;
            if (!vueApp) return 'No vueApp';
            const pinia = vueApp.config.globalProperties.$pinia;
            if (!pinia) return 'No pinia';
            const tryon = pinia._s.get('tryon');
            if (!tryon) return 'No tryon';
            tryon.setGarment({
              id: 'anime:SPR-0001',
              title: '二次元 SPR-0001',
              thumbnail_url: 'https://paipiange.github.io/nvzhuang/assets/anime/thumbs/SPR-0001.webp',
              image_url: 'https://paipiange.github.io/nvzhuang/assets/anime/img/SPR-0001.webp'
            });
            tryon.setPortrait({
              id: 'f71f980dde3',
              name: '长发优雅 · 模特',
              thumbnail_url: 'https://paipiange.github.io/nvzhuang/assets/portrait/thumbs/f71f980dde3.webp',
              image_url: 'https://paipiange.github.io/nvzhuang/assets/portrait/thumbs/f71f980dde3.webp'
            });
            return 'populated';
          })()`,
        })
        await new Promise(r => setTimeout(r, 2000))
      },
    },
    {
      name: 'preview-4-knowledge-index.png',
      title: '知识库首页 · 穿搭与生图系统指南',
      url: `http://127.0.0.1:${PORT}/#/pages/knowledge/index`,
      setup: async (client) => {
        await new Promise(r => setTimeout(r, 2500))
      },
    },
    {
      name: 'preview-5-prompt-lexicon.png',
      title: '知识库详情 · 二次元穿搭图鉴与中英提示词词典',
      url: `http://127.0.0.1:${PORT}/#/pages/knowledge/detail?id=kb-anime-style-guide`,
      setup: async (client) => {
        await new Promise(r => setTimeout(r, 2500))
        // 滚动到提示词区域居中展示
        await client.send('Runtime.evaluate', {
          expression: `
            const el = document.querySelector('.prompts-group');
            if (el) {
              el.scrollIntoView({ behavior: 'instant', block: 'center' });
            } else {
              window.scrollTo({ top: 900, behavior: 'instant' });
            }
          `,
        })
        await new Promise(r => setTimeout(r, 1000))
      },
    },
    {
      name: 'preview-6-models.png',
      title: 'AI 模特库 · 1499位发型造型分类挑选',
      url: `http://127.0.0.1:${PORT}/#/pages/models/index`,
      setup: async (client) => {
        await new Promise(r => setTimeout(r, 2500))
      },
    },
    {
      name: 'preview-7-mine.png',
      title: '我的衣橱 · 个人心动款与知识库入口',
      url: `http://127.0.0.1:${PORT}/#/pages/mine/index`,
      setup: async (client) => {
        await new Promise(r => setTimeout(r, 2500))
      },
    },
  ]

  try {
    for (const task of tasks) {
      console.log(`\nCapturing [${task.name}]: ${task.title}...`)
      const targetRes = await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })
      const target = await targetRes.json()

      const ws = new WebSocket(target.webSocketDebuggerUrl)
      await new Promise(r => ws.onopen = r)
      const client = new CDPClient(ws)

      await client.send('Page.enable')
      await client.send('Runtime.enable')

      // iPhone 14 移动端高保真视口 (390 x 844, 2x Retina, 780x1688 px)
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 2,
        mobile: true,
        screenOrientation: { angle: 0, type: 'portraitPrimary' },
      })

      await client.send('Emulation.setUserAgentOverride', {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      })

      await client.send('Page.navigate', { url: task.url })
      if (task.setup) {
        await task.setup(client)
      }

      const shotRes = await client.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      })

      const outPath = path.join(DOCS_DIR, task.name)
      fs.writeFileSync(outPath, Buffer.from(shotRes.data, 'base64'))
      console.log(`Saved: ${outPath} (${(shotRes.data.length * 0.75 / 1024).toFixed(1)} KB)`)

      ws.close()
      await fetch(`http://127.0.0.1:9222/json/close/${target.id}`)
    }

    console.log('\nAll 7 high-res preview screenshots updated successfully!')
  } finally {
    chromeProc.kill()
    server.close()
  }
}

main().catch(console.error)
