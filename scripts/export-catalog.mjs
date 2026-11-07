import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

const ASSET_BASE_URL = process.env.ASSET_BASE_URL || 'https://paipiange.github.io/nvzhuang/assets'

const CATEGORY_MAP = {
  '春': 'spring',
  '夏': 'summer',
  '秋': 'autumn',
  '冬': 'winter',
  'ランジェリー': 'lingerie',
  'パーティ': 'party',
  '水着': 'swimwear',
  'セクシー': 'sexy',
}

const CATEGORY_NAMES_ZH = {
  spring: '春季甄选',
  summer: '清凉夏日',
  autumn: '温柔秋意',
  winter: '暖冬质感',
  lingerie: '贴身家居',
  party: '聚会焦点',
  swimwear: '度假泳装',
  sexy: '轻奢性感',
}

function loadJsData(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8')
  // 将顶层 const/let 替换为 globalThis.xxx = 从而挂载到 sandbox 上
  content = content.replace(/^const\s+([A-Za-z0-9_]+)\s*=/gm, 'globalThis.$1 =')
  const sandbox = {}
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(content, sandbox)
  return sandbox
}

console.log('📦 Loading raw dataset files...')
const rawData = loadJsData(path.join(rootDir, 'data.js'))
const rawAnime = loadJsData(path.join(rootDir, 'data-anime.js'))
const rawPortrait = loadJsData(path.join(rootDir, 'data-portrait.js'))

console.log(`Loaded: ${rawData.D.length} real garments, ${rawAnime.D_ANIME.length} anime garments, ${rawPortrait.D_PORTRAIT.length} portraits.`)

// 转换真实服装
const realGarments = rawData.D.map((item) => {
  const catKey = CATEGORY_MAP[item['カテゴリ']] || 'spring'
  const keywords = item['キーワード'] ? item['キーワード'].split(/\s+/).filter(Boolean) : []
  const thumbUrl = item['サムネ'].startsWith('http') ? item['サムネ'] : `${ASSET_BASE_URL}/${item['サムネ']}`
  const imgUrl = item['画像'].startsWith('http') ? item['画像'] : `${ASSET_BASE_URL}/${item['画像']}`
  const origUrl = item['原寸'] ? (item['原寸'].startsWith('http') ? item['原寸'] : `${ASSET_BASE_URL}/${item['原寸']}`) : undefined

  return {
    id: `real:${item.id}`,
    original_id: item.id,
    library: 'real',
    category: catKey,
    title: `经典款 ${item.id}`,
    keywords,
    thumbnail_url: thumbUrl,
    image_url: imgUrl,
    original_url: origUrl,
  }
})

// 转换动漫服装
const animeGarments = rawAnime.D_ANIME.map((item) => {
  const catKey = CATEGORY_MAP[item['カテゴリ']] || 'spring'
  const keywords = item['キーワード'] ? item['キーワード'].split(/\s+/).filter(Boolean) : []
  const thumbUrl = item['サムネ'].startsWith('http') ? item['サムネ'] : `${ASSET_BASE_URL}/${item['サムネ']}`
  const imgUrl = item['画像'].startsWith('http') ? item['画像'] : `${ASSET_BASE_URL}/${item['画像']}`
  const origUrl = item['原寸'] ? (item['原寸'].startsWith('http') ? item['原寸'] : `${ASSET_BASE_URL}/${item['原寸']}`) : undefined

  return {
    id: `anime:${item.id}`,
    original_id: item.id,
    library: 'anime',
    category: catKey,
    title: `二次元 ${item.id}`,
    keywords,
    thumbnail_url: thumbUrl,
    image_url: imgUrl,
    original_url: origUrl,
  }
})

// 合并所有服装
const allGarments = [...realGarments, ...animeGarments]

// 模特人像数据转换（包含发型与标签分类）
const portraits = rawPortrait.D_PORTRAIT.map((item) => {
  const thumbUrl = item['サムネ'].startsWith('http') ? item['サムネ'] : `${ASSET_BASE_URL}/${item['サムネ']}`
  const imgUrl = item['画像'].startsWith('http') ? item['画像'] : `${ASSET_BASE_URL}/${item['画像']}`
  const hair = item.hairZh || item['カテゴリ'] || '精致'
  const style = item.styleZh || ''
  const name = style ? `${hair} · ${style.slice(0, 12)}` : `${hair}模特 ${item.id.slice(0, 4)}`

  return {
    id: item.id,
    name,
    thumbnail_url: thumbUrl,
    image_url: imgUrl,
    original_url: item['原寸'],
    hairstyle: hair,
    tags: [item.secZh, item.hairZh, item.styleZh].filter(Boolean),
  }
})

// 计算各分类数量
const catCounts = {}
Object.keys(CATEGORY_MAP).forEach((k) => {
  const mapped = CATEGORY_MAP[k]
  catCounts[mapped] = 0
})

allGarments.forEach((g) => {
  if (catCounts[g.category] !== undefined) {
    catCounts[g.category]++
  }
})

const categories = Object.keys(CATEGORY_NAMES_ZH).map(key => ({
  id: key,
  name: CATEGORY_NAMES_ZH[key],
  count: catCounts[key] || 0,
}))

// 构建全量导出的 Catalog 数据结构
const catalogData = {
  meta: {
    total_garments: allGarments.length,
    real_count: realGarments.length,
    anime_count: animeGarments.length,
    portraits_count: portraits.length,
    updated_at: new Date().toISOString(),
  },
  categories,
  garments: allGarments,
  portraits,
}

// 构建精简版（每个分类取前 8 款真实 + 前 8 款动漫，共约 128 款），供小程序主包离线零网络极速兜底
const liteGarments = []
const seenPerCatReal = {}
const seenPerCatAnime = {}

realGarments.forEach((g) => {
  seenPerCatReal[g.category] = (seenPerCatReal[g.category] || 0) + 1
  if (seenPerCatReal[g.category] <= 8) {
    liteGarments.push(g)
  }
})

animeGarments.forEach((g) => {
  seenPerCatAnime[g.category] = (seenPerCatAnime[g.category] || 0) + 1
  if (seenPerCatAnime[g.category] <= 8) {
    liteGarments.push(g)
  }
})

const catalogLiteData = {
  meta: {
    total_garments: allGarments.length,
    real_count: realGarments.length,
    anime_count: animeGarments.length,
    portraits_count: portraits.length,
    is_lite: true,
    updated_at: new Date().toISOString(),
  },
  categories,
  garments: liteGarments,
  portraits: portraits.slice(0, 16),
}

// 写入前端目录
const appDataDir = path.join(rootDir, 'app/src/static/data')
if (!fs.existsSync(appDataDir)) {
  fs.mkdirSync(appDataDir, { recursive: true })
}
const appCatalogLitePath = path.join(appDataDir, 'catalog-lite.json')
fs.writeFileSync(appCatalogLitePath, JSON.stringify(catalogLiteData), 'utf-8')
console.log(`✅ Front-end lite catalog written to: ${appCatalogLitePath} (${(fs.statSync(appCatalogLitePath).size / 1024).toFixed(1)} KB)`)

// 写入后端目录（供 GoFrame /api/v1 路由离线极速读取）
const backendDataDir = path.join(rootDir, 'backend/internal/logic/catalog/data')
if (!fs.existsSync(backendDataDir)) {
  fs.mkdirSync(backendDataDir, { recursive: true })
}
const backendCatalogPath = path.join(backendDataDir, 'catalog.json')
fs.writeFileSync(backendCatalogPath, JSON.stringify(catalogData), 'utf-8')
console.log(`✅ Backend full catalog written to: ${backendCatalogPath} (${(fs.statSync(backendCatalogPath).size / 1024).toFixed(1)} KB)`)

console.log('🎉 Catalog export completed successfully!')
