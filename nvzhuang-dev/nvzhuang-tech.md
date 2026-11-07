# 衣装集（nvzhuang）移动端技术实现文档

> **执行用途**：将本文件连同 `nvzhuang-ui.html`、`nvzhuang-ui-preview.png` 一起交给 Codex / Claude Code / OpenCode。AI 应依照本文实现真实可运行代码，而不是只生成静态示意图。
>
> **技术栈锁定**：uni-app + Vue 3 + TypeScript + **unibest** + Pinia + UnoCSS + Wot UI（脚手架支持的版本）+ GoFrame v2（复用现有后端）。
>
> **目标平台**：微信小程序、Android App、H5；iOS App 保留兼容能力，非首发硬性要求。
>
> **文档状态**：实施规格 v1.0，2026-11-07。本文提到的 `/api/v1/*` 均为**拟新增接口**，不是声称仓库当前已实现。

---

## 0. 给编码 AI 的总指令（先读）

你是该项目的前端主程兼 API 集成人员。**请直接执行，不要只给方案。** 用户已有 UI 原型、原项目和本文技术规格；尽量不额外提问，阻塞时选择安全默认实现并在交付记录中说明。

1. **先检查仓库与原型**：读取 `https://github.com/paipiange/nvzhuang` 当前 `main` 的 `README.md`、`data.js`、`data-anime.js`、`data-portrait.js`、`backend/api/tryon/v1/tryon.go` 和 `backend/internal/cmd/cmd.go`；读取本目录内的 `nvzhuang-ui.html` 与 `nvzhuang-ui-preview.png`。**不覆盖已有 Git 改动**，不要自动推送。
2. **使用 unibest CLI 初始化独立移动端工程**；禁止将原有网页的巨大 `index.html` 直接嵌入 `web-view` 冒充跨端移植；应用页必须由 `.vue` 组件实现。
3. **UI 尽量 1:1 还原视觉原型**（配色、间距、布局、圆角、文案、导航），但原型里的矢量示意图片只能用于开发占位。正式图库必须使用 nvzhuang 仓库真实素材或获得授权的 CDN 素材，不能把示意换装结果当成真实 AI 生成结果。
4. 现有 GoFrame **`POST /tryon`** 是真实接口。本文所有新增 REST API 必须按“先 mock → 实现后端 → 联调”推进；不能将未开发接口伪装为已接通。
5. **先保证 H5、微信小程序、Android 编译与基础功能**；图集可以脱离登录浏览。真实 AI 试衣必须通过服务端鉴权、限额和成本保护，严禁在前端内置模型 API Key/共享后端 Token。
6. 每完成一阶段，执行格式检查、类型检查、构建以及最低限度的手工验证；提供具体测试命令、结果与尚未实现项，不允许只口头说“已完成”。

## 1. 现有项目核对：能复用什么

源仓库：`https://github.com/paipiange/nvzhuang`；演示：`https://paipiange.github.io/nvzhuang/`。

当前 README 描述的资源量：**写实服装 1,407 套、动漫服装 1,320 套、AI 模特 1,499 位**。开发时以代码实际枚举数量为准，不要把文案硬编码成不可更新的数据。现有静态前端文件包括：

| 源文件 / 功能 | 当前情况 | 移动端处理方式 |
|---|---|---|
| `data.js` | 写实服装元数据，常量 `D` | 编写一次性导入脚本，转为结构化 JSON；图片只引用 URL |
| `data-anime.js` | 动漫服装元数据，常量 `D_ANIME` | 同上；用 `anime:` 前缀避免与写实 ID 冲突 |
| `data-portrait.js` | AI 人像/模特元数据 | 转为可分页的模特清单，保留原字段映射 |
| `assets/thumbs/`、`assets/img/` | 写实缩略图与展示图 | 放 CDN / 静态对象存储；首屏只取缩略图 |
| `assets/anime/` | 动漫图集 | 同上 |
| `assets/portrait/` | AI 模特相关图片 | 同上 |
| `backend/` | GoFrame v2 AI 试衣后端 | **保留复用**，在后端增量加移动端 API / 网关 |
| `POST /tryon` | 已有真实 AI 换装接口 | 一期只通过有鉴权的 BFF/API 网关访问 |
| `GET /comfyui/health` | 已有服务端 ComfyUI 健康检查 | 仅管理员或诊断用，普通用户无需看到 |
| 前端浏览器本地历史 | IndexedDB 保存生成记录 | 小程序/App 不依赖浏览器 IndexedDB；后期改服务端历史或本地文件 + 元数据 |
| 购买同款 | 网页已有淘宝以图搜同款入口 | **按平台差异实现**，不能假定微信小程序能直接打开淘宝搜索 |

**重要事实：**现有 `POST /tryon` 请求为 JSON：`person_image` 和 `garment_image`（Base64）、`model`、`size`、`keep_face`、`lang`、可选 `client_config`；返回图片 Base64、MIME、模型等字段。**当前它并不是**图片上传 API、任务队列 API、图库列表 API 或用户收藏 API。

## 2. 产品范围与开发优先级

### P0：必须做成能使用的 MVP

- **发现**：轮播/主题 Banner、热门推荐、快捷分类、热门穿搭瀑布流或双列网格、点击跳转详情。
- **图库**：写实 / 动漫两种图库切换、搜索（中英关键词）、季节分类、分页加载、图片预览、收藏。
- **服装详情**：大图、关键词标签、所属图库、收藏、`穿上这件`、`找同款`（合规跳转或复制提示）。
- **AI 试衣间**：选择人像（相册/拍照或图库内 AI 模特）、选择服装、选择服务端允许的模型、确认生成、等待状态、显示结果、保存分享。
- **我的**：收藏列表、生成历史、设置、隐私说明、清理本地数据。游客仍可收藏到本机。
- 三端适配：H5、微信小程序、Android App，空态/失败态/加载态完整。

### P1：后端与生产化

- 图库 / 模特数据转换并由 API 分页提供；CDN 资源托管。
- 用户鉴权、真实图片上传、模型转发、任务状态、试衣历史、删除图片和基础风控。
- 服务端数据库持久收藏（游客收藏可暂存本机，登录后合并）。

### P2：暂缓，不允许阻碍 MVP

- 真实订单支付、会员与积分售卖、复杂个性化推荐、社区发帖、第三方电商深度 API、视频换装。
- iOS 正式上架；备案/支付/隐私审核须在发布前专项确认。

> 原型只有四个底部 Tab：**发现 / 图库 / 试衣间 / 我的**。收藏与历史属于「我的」的二级页，**不要擅自改成 5 个 Tab**。

## 3. 设计规格：必须还原原型

### 3.1 主题 Token

| Token | 值 | 用途 |
|---|---|---|
| `--bg-page` | `#FCFBFA` | 页面奶油白背景 |
| `--primary` | `#CD7188` | 玫瑰粉主按钮、选中状态 |
| `--primary-soft` | `#F8E9ED` | 标签与选中浅底 |
| `--text-main` | `#272225` | 标题主文字 |
| `--text-secondary` | `#9A8E91` | 次级说明 |
| `--surface-soft` | `#F4F1F0` | 搜索框、筛选胶囊 |
| `--border` | `#EEE7E7` | 分割线 |
| `--radius-card` | `16px`（设计稿参考） | 卡片圆角 |
| `--radius-control` | `12px` | 输入框等 |
| `--radius-pill` | `999px` | 标签与胶囊按钮 |

- 字体：系统字体优先（`PingFang SC` / `Microsoft Yahei`）；英文艺术字只用于少量品牌标识。
- 逻辑布局宽度参考 375 px 手机；统一用 `rpx` / flex，不能以固定 340 px 手机模型坐标硬编码；文字最小可读字号，触控区域尽量不小于 44×44 逻辑 px。
- 服装图真实素材接近 **2:3**；图片统一 `mode="aspectFill"`（卡片）/ `aspectFit`（详情），严格保持比例，不能拉伸。
- 顶部尊重微信胶囊及状态栏；底部尊重 iPhone 安全区；页面底部滚动不得被 TabBar 挡住。
- UI 截图对应：`nvzhuang-ui-preview.png`。HTML 对应：`nvzhuang-ui.html`。**仅作为布局/交互参照，不要把 DOM/CSS/JS 整体复制进 uni-app。**

### 3.2 页面清单和交互定义

| 页面 | 建议路由 | 关键组成和动作 | 数据来源 |
|---|---|---|---|
| 发现（Tab） | `/pages/index/index` | 品牌标题、活动 Banner、搜索入口、快捷分类、精选列表、前往试衣间 | `catalog` API / mock |
| 图库（Tab） | `/pages/gallery/index` | 写实/动漫切换、搜索、分类 tabs、两列卡片、分页刷新 | `garments` API / mock |
| 试衣间（Tab） | `/pages/tryon/index` | 人像选择、服装选择、模型选择、尺寸选项、生成 CTA、状态反馈 | 本地草稿 + tryon API |
| 我的（Tab） | `/pages/mine/index` | 头像/游客、收藏、历史、设置、隐私 | Pinia / API |
| 服装详情 | `/pages/garment/detail` | 服装大图、描述标签、收藏、找同款、穿上这件 | 服装详情 API |
| 选 AI 模特 | `/pages/models/index` | 模特列表、筛选、回填试衣间 | 模特 API |
| 结果详情 | `/pages/tryon/result` | 成果图片、原图对比、保存、分享、重新生成 | 任务 API / 本地草稿 |
| 我的收藏 | `/pages/mine/favorites` | 本机/云端收藏、取消收藏、进入详情 | Store / API |
| 生成记录 | `/pages/mine/history` | 历史、任务状态、继续查看、删除 | API / 本机 |
| 设置 | `/pages/mine/settings` | 隐私、清缓存、语言预留、调试环境开关（仅开发态） | 本机配置 |

**页面主流程：**

```text
发现/图库 → 卡片 → 服装详情 →「穿上这件」→ AI试衣间
                                     ├─ 上传/拍照选择人物
                                     ├─ 选内置 AI 模特
                                     └─ 选服务端可用模型 → 发起生成
                                                              ↓
                                                    处理中/失败/成功
                                                              ↓
                                          结果详情 → 保存/分享/找同款

我的 → 收藏 → 详情 → 试衣间
我的 → 生成记录 → 结果详情
```

- 从详情进入试衣间时，必须传 `garment_id`、`library`；用户返回后已选择的人像和模型应保留。
- 搜索框 300ms 防抖；按图库类型 + 分类 + 搜索关键字一起查询；切换条件时将页码重置为 1，旧请求结果不能覆盖新结果。
- 图片加载需骨架屏、加载失败图、重试；列表支持下拉刷新和上拉加载，翻页去重。
- 收藏点击即时反馈并持久化；游客无需强制登录。
- 上传前提示仅使用本人或有权使用的人像。无预授权时不自动上传。
- 结果保存需申请平台相应授权；分享失败时提供保存图片/复制链接等实际可用的退路。

## 4. unibest 项目初始化和依赖选型

### 4.1 推荐目录策略

不破坏原 `nvzhuang` 根目录网页。建议新增 **`mobile/`** 作为独立 unibest 前端工程；后端继续保留 `backend/`。若编码环境只能创建独立仓库，也可单独创建 `nvzhuang-mobile`。

### 4.2 初始化命令

```bash
# Node.js >= 20, pnpm >= 9, Git
pnpm create unibest mobile
cd mobile
pnpm install

# H5
pnpm dev:h5

# 微信小程序（导入 dist/dev/mp-weixin 到微信开发者工具）
pnpm dev:mp-weixin

# App（需要 HBuilderX 或相应发行工具链）
pnpm dev:app
```

按照 CLI 的**当前实际选项**选择 `Vue3 + TypeScript + UnoCSS + Wot UI / wot-ui-v2（实际能在三端运行的版本） + Pinia`。**不要强行指定未经验证的旧版依赖版本**；锁文件由 CLI 生成，并固定提交。

- UI：服装展示、品牌卡片、试衣对比栏用自定义 Vue 组件；输入框、对话框、加载态使用 Wot UI，避免强行套统一组件破坏原型。
- 请求：优先用 unibest 的 `src/http/http.ts` 轻封装（确认脚手架生成的真实文件名后再修改）；不为简单 CRUD 同时引入 Alova、Axios 和 Vue Query。
- 状态：Pinia，少量状态本地持久化到 `uni.setStorageSync` / 对应跨端适配插件；**不要持久化 Base64 大图、API Key、未经授权的人像**。
- 大列表：优先 `z-paging`，若当前 CLI 未包含，则采用 `scroll-view` + 分页状态、或引入三端已验证的版本。
- 布局与路由：遵守 unibest 的**约定式路由**和 `pages.config.ts` / 页面注释约定；不要手动维护与生成器冲突的第二套路由。
- 图标：UnoCSS icons 或 PNG 资源均可；真实微信小程序与 App 必须验证 SVG/图标包兼容，不依赖浏览器专用 DOM。

### 4.3 推荐目录结构

```text
nvzhuang/
├── backend/                        # 原 GoFrame v2（增量扩展）
├── data.js / data-anime.js / data-portrait.js
├── assets/                         # 原始图片资源
├── mobile/                         # 新建 unibest 项目
│   ├── src/
│   │   ├── pages/
│   │   │   ├── index/index.vue
│   │   │   ├── gallery/index.vue
│   │   │   ├── tryon/index.vue
│   │   │   ├── mine/index.vue
│   │   │   ├── garment/detail.vue
│   │   │   ├── models/index.vue
│   │   │   ├── tryon/result.vue
│   │   │   └── mine/{favorites,history,settings}.vue
│   │   ├── components/
│   │   │   ├── AppTabbar.vue
│   │   │   ├── GarmentCard.vue
│   │   │   ├── GarmentGrid.vue
│   │   │   ├── CategoryChips.vue
│   │   │   ├── EmptyState.vue
│   │   │   ├── ImagePickerCard.vue
│   │   │   ├── ModelSelector.vue
│   │   │   └── TryonCompare.vue
│   │   ├── api/
│   │   │   ├── catalog.ts
│   │   │   ├── garment.ts
│   │   │   ├── models.ts
│   │   │   ├── auth.ts
│   │   │   ├── upload.ts
│   │   │   └── tryon.ts
│   │   ├── store/
│   │   │   ├── favorites.ts
│   │   │   ├── tryon.ts
│   │   │   └── user.ts
│   │   ├── composables/
│   │   │   ├── useGarments.ts
│   │   │   └── useTryonJob.ts
│   │   ├── types/
│   │   │   ├── garment.ts
│   │   │   ├── tryon.ts
│   │   │   └── api.ts
│   │   ├── utils/
│   │   │   ├── media.ts
│   │   │   ├── platform.ts
│   │   │   └── storage.ts
│   │   ├── styles/
│   │   │   └── tokens.scss
│   │   └── static/                # 仅少量 Logo、icons、placeholder
│   ├── pages.config.ts
│   ├── manifest.config.ts
│   ├── uno.config.ts
│   ├── vite.config.ts
│   └── ...                        # 保留 CLI 实际生成的文件
├── scripts/
│   └── export-catalog.(js|py)     # 离线生成图集索引
└── docs/
    └── MOBILE_API_SPEC.md        # 后续接口契约
```

目录是目标逻辑分层，须以**脚手架真实约定**为准，允许调整，但不要遗漏关键业务模块。

## 5. 类型定义与业务数据

### 5.1 图集数据转换规则

源 `data.js` / `data-anime.js` 包含日语字段（如 `カテゴリ`、`キーワード`、`サムネ`、`画像`）；**仅允许构建/导入脚本解析转换**，运行时不直接把大型 JS 数组注入小程序主包。

- `library`: `real`（写实）或 `anime`（动漫）。
- 主键：`id = library + ':' + original_id`，例 `real:SPR-0001`、`anime:SPR-0001`；确保两个图库不撞 ID。
- `category`：源分类统一映射为 `spring/summer/autumn/winter/lingerie/party/swimwear/sexy`，UI 中文展示。**正式发布时需按平台内容规范审查敏感分类与素材**。
- `keywords`: 保留原始英文关键词；可另建中文搜索别名与索引。**没有真实服装名称时，不要编造商品品牌、价格、库存；列表显示「服装 SPR-0001」+ 有依据的标签。**
- `thumbnail_url`、`image_url`：必须补全为 HTTPS 绝对地址，不能使用相对 `thumbs/...` 而不知图片域名。
- `original_url`：仅当可信可用才展示；远端不存在时隐藏下载原图按钮。
- 模特库按原字段结构单独转换、分类和索引，不要与服装 ID 混用。
- 图片资源通过 HTTPS CDN/OSS/R2 托管，**不要把几千张图片打包进小程序 `static/`**。建议使用 webp 缩略图，详情按需加载大图。

### 5.2 TypeScript 类型（直接建文件）

```ts
// src/types/garment.ts
export type LibraryType = 'real' | 'anime'
export type GarmentCategory =
  | 'spring' | 'summer' | 'autumn' | 'winter'
  | 'lingerie' | 'party' | 'swimwear' | 'sexy'

export interface Garment {
  id: string                   // real:SPR-0001 / anime:SPR-0001
  original_id: string
  library: LibraryType
  category: GarmentCategory
  title: string                // 真实可核对名称；否则服装编号
  keywords: string[]
  thumbnail_url: string
  image_url: string
  original_url?: string
  is_favorite?: boolean       // 客户端派生，非服务端单一真相
}

export interface PageResult<T> {
  list: T[]
  page: number
  page_size: number
  total: number
  has_more: boolean
}

export interface ModelPortrait {
  id: string
  name: string
  thumbnail_url: string
  image_url: string
  hairstyle?: string
  tags: string[]
}
```

```ts
// src/types/tryon.ts
export type TryonStatus = 'idle' | 'uploading' | 'queued'
  | 'processing' | 'success' | 'failed' | 'cancelled'

export interface TryonDraft {
  garmentId: string | null
  personLocalPath: string | null    // 临时本地路径，仅当前会话
  selectedPortraitId: string | null
  modelKey: string                  // 如 gemini/doubao，仅从后端可用清单选择
  size: '1024x1024' | '1024x1536' | '1536x1024'
  keepFace: boolean
}

export interface TryonJob {
  id: string
  status: Exclude<TryonStatus, 'idle' | 'uploading'>
  progress?: number                // 仅后端有真实进度才显示
  result_url?: string
  error_code?: string
  error_message?: string
  created_at: string
}
```

## 6. API 契约：已有接口和拟新增接口严格区分

### 6.1 已存在：GoFrame 换装底层

`POST /tryon`（现有仓库）

```json
{
  "person_image": "<BASE64_PERSON>",
  "garment_image": "<BASE64_GARMENT>",
  "model": "gemini",
  "size": "1024x1536",
  "keep_face": true,
  "lang": "zh"
}
```

业务结果数据结构包含：`image`（Base64）、`mime`、`model`、`prompt`（可选）；实际 HTTP 响应可能存在 GoFrame `code/message/data` 包装，**编码前应实测真实响应，并统一适配**。**不要让客户端直接在公网调用这个接口，也不要把任何可复用的私有 Bearer Token 打包到 App**。

推荐在服务端新增 `tryon-gateway`：认证→上传文件 ID 解引用→图片格式/大小校验→按模型配置调用现有 `tryon` 业务逻辑→对象存储结果→返回任务结果 URL。可以先同步生成、再改异步任务，但对外始终保持 `job` 协议。

### 6.2 拟新增：移动端 API（须实现）

统一前缀：`/api/v1`。统一响应建议：

```json
{ "code": 0, "message": "ok", "data": {} , "request_id": "..." }
```

列表可直接把 `PageResult<T>` 放在 `data` 内。错误须返回非 2xx HTTP 状态并带 `code`、`message`、`request_id`，客户端不要只依据 HTTP 200 当成功。

| 方法与路径 | 说明 | MVP 阶段 |
|---|---|---|
| `GET /api/v1/catalog/categories` | 分类、图库类型与数量 | mock → 真实 |
| `GET /api/v1/garments` | `library`,`category`,`q`,`page`,`page_size` | mock → 真实 |
| `GET /api/v1/garments/:id` | 服装详情，URL 中含安全编码主键 | mock → 真实 |
| `GET /api/v1/models` | 模特列表：`hairstyle`,`page`,`page_size` | mock → 真实 |
| `POST /api/v1/auth/guest` | 签发短期游客身份、绑定额度（若开放试衣） | P1 |
| `POST /api/v1/auth/wechat` | 接收微信 `code` 并在服务端换会话，不接收客户端 AppSecret | P1 |
| `GET /api/v1/tryon/options` | **服务端白名单**模型、尺寸、额度提示 | mock → 真实 |
| `POST /api/v1/uploads` | 上传图片，返回临时 `file_id` | P1 |
| `POST /api/v1/tryon/jobs` | 创建换装任务 | P1 |
| `GET /api/v1/tryon/jobs/:id` | 查询任务状态与结果 URL | P1 |
| `GET /api/v1/tryon/history` | 当前身份历史，分页 | P1 |
| `DELETE /api/v1/tryon/history/:id` | 删除历史与关联私密结果 | P1 |
| `GET/POST/DELETE /api/v1/favorites` | 登录后收藏同步 | P1；P0 本地可用 |

**请求示例（提案，尚未实现）：**

```http
GET /api/v1/garments?library=real&category=autumn&q=coat&page=1&page_size=20
```

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "list": [{
      "id": "real:AUT-0001",
      "original_id": "AUT-0001",
      "library": "real",
      "category": "autumn",
      "title": "服装 AUT-0001",
      "keywords": ["coat"],
      "thumbnail_url": "https://YOUR_ASSET_HOST/assets/thumbs/AUT-0001.webp",
      "image_url": "https://YOUR_ASSET_HOST/assets/img/AUT-0001.webp"
    }],
    "page": 1,
    "page_size": 20,
    "total": 1407,
    "has_more": true
  }
}
```

以上 `YOUR_ASSET_HOST` 是占位域名；JSON 是**接口形状示范**，并非当前 API 真实返回或匹配查询的实际总数。

**图片上传建议：**`uni.chooseMedia`（目标端支持时）→ 读取临时文件路径 → 本地压缩/预览 → `uni.uploadFile`（multipart）→ 返回 `file_id`。微信小程序/App 使用本地路径上传，不要优先 `FileReader`、`FormData`、`Blob` 这类浏览器对象。用户人像短期保存在受控临时存储、设 TTL、支持主动删除，禁止公开 CDN URL 无鉴权访问。

创建任务体：

```json
{
  "garment_id": "real:AUT-0001",
  "person_file_id": "temp-file-id",
  "portrait_id": null,
  "model_key": "gemini",
  "size": "1024x1536",
  "keep_face": true,
  "client_request_id": "uuid-for-idempotency"
}
```

`person_file_id` 和 `portrait_id` 二选一；后端强制校验，不能同时缺失。对同一个 `client_request_id` 幂等（防重复点击和重试重复扣费）。任务状态 `queued/processing/success/failed/cancelled`；如无真实百分比，UI 只展示阶段和不确定进度条，不伪造 86% 这种数字。

### 6.3 Mock → 真实 API 切换规则

`VITE_API_BASE_URL` 和 `VITE_USE_MOCK`（或者 unibest 当前实际采用的 env 命名）按环境配置，**小程序构建时确认变量确实被注入**：

```ini
# 以下为示意，不代表 CLI 必然使用这一个 env 文件名
VITE_API_BASE_URL=https://api.example.com
VITE_ASSET_BASE_URL=https://assets.example.com
VITE_USE_MOCK=true
```

- P0 可使用本地 JSON `mock` 走**相同 TypeScript 类型和 API 适配层**；不得在页面内硬编码衣服数组和假网络响应。
- P1 关闭 mock 后，同一组件无需重写。微信小程序开发工具的开发模式与真机 HTTPS 合法域名设置应单独验证。
- API 层要处理超时、取消、重试、401、403、413、429、5xx；超限提示原因与重试条件，不允许无限自动重试生成任务。

## 7. 前端关键实现代码与伪代码

### 7.1 封装 API，不将请求散落页面

```ts
// src/api/garment.ts 伪接口；http 导入与传参依据当前 CLI 实际接口调整
import type { Garment, LibraryType, GarmentCategory, PageResult } from '@/types/garment'

export interface GarmentQuery {
  library: LibraryType
  category?: GarmentCategory
  q?: string
  page: number
  page_size: number
}

export async function getGarments(params: GarmentQuery): Promise<PageResult<Garment>> {
  // TODO: 调用当前 unibest 的 http 客户端并解包 data；或 dev Mock 适配器
  // 不在页面里直接 fetch，更不要引用 window/document
  throw new Error('Implement with the selected unibest HTTP adapter')
}
```

> **这里的函数体是接口约束，不是可运行的成品代码**。编码 AI 必须真正实现该函数并在阶段验收时消除 TODO。不要把本文任何 `throw new Error` 留到最终产物。

### 7.2 图库分页状态机

- 每次选择图集/分类/搜索词，`page=1`、清空旧列表、递增 `requestVersion`、发新请求。
- 收到响应时只有当前 `requestVersion` 才能更新列表，避免搜索快输入时显示旧结果。
- 上拉加载只在 `!loading && hasMore` 触发；新一页去重合并；失败时页码不前进。
- 使用 `onShow` 更新收藏状态；不要每次从详情返回都强制清空图库滚动位置。
- 每页默认 20～30 条，建议 20；详情预加载下一张或下一页最多几张，控制流量。

### 7.3 试衣状态机

```text
idle
 └─ 用户选择人像、衣服、模型（前置校验）
     └─ uploading（仅真实照片需要）
         └─ queued
             └─ processing
                 ├─ success → 打开结果页
                 ├─ failed → 清晰显示错误，允许用户主动重试
                 └─ cancelled（若后端支持取消）
```

- 微信小程序页面切后台，回到前台要重新查询任务；本地仅保存 `job_id`、选择配置等**非私密元数据**。
- 同一任务请求不得因断网自动再次创建；优先按 `client_request_id` 查询/幂等重试。
- 结果返回 URL 后加载真实图片，不再把大段 Base64 留在 Pinia 或持久化存储里。
- 使用 `uni.saveImageToPhotosAlbum` 等跨端能力保存前，对服务端私密 URL 做鉴权下载到临时文件；处理保存权限拒绝和重试。
- 图片未生成或任务失败时，绝不能显示示意图并标注“生成成功”。

### 7.4 收藏持久化

- 本地存储字段：`nvzhuang:favorites:v1`，内容为 `string[]` 的稳定服装 ID，不缓存整个大图对象。
- 使用 Pinia 管理，开关收藏时立即更新；列表和详情同步；重进 App 不丢。
- 登录云端后先拉取云端收藏，服务端按 ID 做并集去重，冲突以最后更新时间或集合并集规则为准；未登录本机版本始终可用。
- 用户清除数据时需确认；收藏单独清除不等于删除历史人像文件。

## 8. 三端专项适配（不可跳过）

| 能力 | 微信小程序 | Android App | H5 |
|---|---|---|---|
| 图像选择 | `uni.chooseMedia` / 小程序能力 | `uni.chooseImage` / `uni.chooseMedia` 视平台 | `uni.chooseImage` |
| 图片上传 | `uni.uploadFile`，合法 upload 域名 | `uni.uploadFile`，HTTPS | `uni.uploadFile` |
| 文件保存 | 相册授权与权限处理 | 对应相册权限、Android 系统版本差异 | 下载链接 / 浏览器保存 |
| 页面安全区 | 微信胶囊、自定义导航栏适配 | 状态栏、全面屏底部安全区 | 浏览器安全区 |
| 分享 | `onShareAppMessage` / 小程序支持的分享方式 | 系统分享 | 分享链接 / 复制 |
| 购买同款 | **不能假定跳转淘宝 App**；合规方式做图片保存/关键词复制/已获支持的跳转 | 外部链接或系统 Intent，判定是否安装 | 浏览器打开可用链接 |
| 认证 | `uni.login` 获取 code，后端交换 session | 匿名 Token / 账号登录 | 匿名 Token / 账号登录 |
| 图片域名 | 必须配置 download / request / upload 合法域名，并真机验证 | HTTPS，证书可信 | CORS / HTTPS |

- 适配模块统一 `utils/platform.ts`，少量差异可用 `#ifdef MP-WEIXIN` / `#ifdef APP-PLUS` / `#ifdef H5`；**绝不把平台条件编译写散到所有页面**。
- 微信小程序分享可分享详情路径及 garment ID，但平台对参数、路径和内容有限制；开发者工具与真机分别验证。
- 原网页的 IndexedDB、`document.querySelector`、`window.localStorage`、`URL.createObjectURL` 和 Web DOM 拖拽机制不能直接用于 App/小程序页面。
- 瀑布流若有兼容性问题，P0 使用稳定的**双列等高/卡片网格**，优先正确点击、滚动与图片性能。
- 面向 Android 与小程序的图片体积、首屏数量、懒加载尤其重要；列表尽量使用缩略图。

## 9. 后端 GoFrame v2 增量改造

### 9.1 保留原有逻辑，新增移动端模块

```text
backend/
├── api/tryon/               # 原有 API 不破坏
├── internal/controller/tryon/
├── internal/logic/tryon/    # 原生图逻辑复用
└── [建议新增]
    ├── api/mobile/           # /api/v1/... 请求/响应结构
    ├── internal/controller/mobile/
    ├── internal/logic/catalog/
    ├── internal/logic/portrait/
    ├── internal/logic/upload/
    ├── internal/logic/tryonjob/
    ├── internal/logic/favorite/
    └── internal/logic/auth/
```

真实目录名称可按 GoFrame 惯例微调，禁止复制一套模型适配器替代已有 `logic/tryon`。将原有 `/tryon` 视为底层能力，对外 `/api/v1/tryon/jobs` 增加可靠的身份与异步协议。

### 9.2 MVP 数据模型（建议 MySQL/MariaDB）

| 表 | 主字段 | 目的 |
|---|---|---|
| `mobile_users` | `id`, `platform`, `openid_hash/subject`, `status`, `created_at` | 用户/游客会话绑定；不存明文敏感凭据 |
| `mobile_favorites` | `user_id`,`garment_id`,`created_at` | 唯一索引 `(user_id, garment_id)` |
| `mobile_uploads` | `id`,`user_id`,`object_key`,`mime`,`size`,`expires_at`,`deleted_at` | 私密临时上传；TTL/删除 |
| `mobile_tryon_jobs` | `id`,`user_id`,`garment_id`,`person_file_id`,`portrait_id`,`model`,`status`,`error_code`,`result_key`,`created_at`,`updated_at` | 作业状态和归属 |
| `mobile_quota_events` | `id`,`user_id`,`job_id`,`cost_units`,`created_at` | 日额度、计费与风控 |

图库可先使用**静态生成的 JSON + CDN**，无须立刻把所有数据写进 MySQL；若需复杂搜索，再导入 `garments`、`portraits` 表并加索引。Redis（可选）用于限流、短期身份、任务状态与分布式锁；若采用异步任务，使用可靠队列或 DB 状态机，不用只靠进程内 goroutine（服务重启会丢任务）。

### 9.3 真实生成流程

```text
客户端选人像/服装
     ↓
上传临时人像 → 服务端生成 file_id（校验身份与 MIME）
     ↓
POST /api/v1/tryon/jobs（幂等键 + 限额检查）
     ↓
任务队列 / DB 任务状态
     ↓
服务端根据 garment_id 读取受信任服装图
     ↓
调用现有 GoFrame tryon 模型逻辑（后端持有 Key）
     ↓
检测输出图片、保存私有结果存储
     ↓
GET job 返回 success + 受控图片 URL
     ↓
客户端展示、按需保存；可删除历史及关联图片
```

### 9.4 安全最低要求

- **不允许匿名无限次调用付费模型**；必须支持用户/游客身份、设备/账号/IP 组合速率限制、每日额度、并发限制、预算上限、封禁滥用。
- 前端不得持有服务器 OpenAI/Gemini/豆包等 API Key 或共享生成 Token；用户自备 Key 的“专家模式”仅以后经安全评估再做，默认不暴露。
- 上传、拉取和删除人像/结果需做用户归属校验；结果 URL 短时效，避免公共静态永久暴露。
- 严格检测 MIME 文件签名、文件大小、像素与长宽；复用原有 `imagevalidate` 逻辑，限额以现有配置为准，不能仅靠扩展名。
- 明确向用户告知：换装图像可能由模型提供商处理，遵循实际数据路径和提供商政策；支持用户删除历史与相关图像。
- 后端日志不可记录原始 Base64、人像文件、API Key 或敏感 URL。
- `client_request_id` 幂等校验、超时、失败重试上限；任务失败可按产品策略退回额度，规则公开。
- 小程序公开分类及内容、用户上传内容需要发布前内容安全审核与合法的素材授权；API Key 不能因“只在小程序里”就视为安全。

## 10. 图片资源和性能方案

1. 做一次性索引转换，输出 `garments-real.json`、`garments-anime.json`、`portraits.json` 或导入数据库；转换脚本带重复 ID、丢失文件、图片路径、分类映射测试。
2. CDN 缩略图按需要提供适合 2 列卡片的尺寸，大图放在详情/试穿前按需取。实际图片域名用自有 HTTPS 子域，配微信域名白名单。
3. 首屏只请求 10～20 张缩略图；下滑按 20 条分页；预加载限制，拒绝全量加载数千张图。
4. 推荐列表可按固定精选 ID 清单或后端 `featured` 字段；不要为了看似智能而造不存在的推荐算法。
5. 上传人物可在本机压缩后再上传，但须兼顾清晰度与后端当前尺寸限制；压缩后的尺寸/文件量在上传前显示，拒绝过大的请求并说明。
6. 开发态图片路径可指向 `https://paipiange.github.io/nvzhuang/assets/...` 等经验证可用地址；生产应迁至正式 HTTPS 静态域名并完成素材许可核验。
7. 保留占位骨架、离线失败重试和节流，弱网下卡片布局不抖动。

## 11. 推荐开发顺序：按阶段交付

### 阶段 A：unibest 基架 + UI 还原

- 初始化 `mobile/` 并可运行三端开发命令。
- 引入 design tokens、全局字体、Tabbar、导航栏、安全区。
- 完成原型四个 Tab、详情、收藏、结果、设置等 Vue 页面。
- 采用真实可复用的 Vue 组件与 mock 数据；底部 Tab 可切换；页面动作不为空按钮。
- **验收**：H5 截图与原型关键布局一致；没有浏览器 DOM 错误；微信小程序构建成功；Android 能启动。

### 阶段 B：真实图库和收藏

- 完成数据转换脚本及测试，挂入 `api/` 的 mock/真实双适配。
- 全量图库可翻页，搜索、分类、图库切换正确；详情展示真实图片与 ID。
- 收藏重启不丢，列表/详情一致；空态与网络重试可用。
- **验收**：实际首 3 页不重复/不丢；写实/动漫同编号独立收藏；中英文搜索可得到匹配结果。

### 阶段 C：真实试衣闭环

- 新增 GoFrame 上传、用户身份、任务 API；把生成流程接到已有 `/tryon` 模型逻辑。
- 试衣间选择人物/AI 模特、服装、模型；创建任务、查询进度、结果展示、保存图片。
- 接入成本限制、错误码、日志脱敏、自动过期清理。
- **验收**：自备有效服务端模型 Key 的情况下，选 1 张授权人像 + 1 件真实服装可以得到**真实结果**；失效 Key/额度不足/超时能正确反馈，不出现假成功。

### 阶段 D：跨端兼容 + 发布准备

- 微信真机：选图、上传、结果保存、分享、图片域名、授权失败可恢复。
- Android 真机：选择图片、权限、保存、分享、弱网及前后台切换。
- H5：布局、图片加载、跨域、浏览器下载。
- 含隐私政策、数据删除和内容审核的发布前检查；输出构建产物路径和手工测试记录。

## 12. 测试清单（必须逐项给出结果）

### 12.1 编译与静态检查

```bash
cd mobile
pnpm install
# 以下具体 script 以 CLI 生成 package.json 为准；不存在则补充等价脚本
pnpm exec vue-tsc --noEmit
pnpm lint
pnpm build:h5
pnpm build:mp-weixin
# App 的正式打包需按 unibest / HBuilderX 当前工具链执行
```

> `vue-tsc`/`lint`/`build:*` 是否已有脚本先查看 `package.json`。不要出现“命令不存在”但仍宣称通过的情况。

### 12.2 人工冒烟测试

- [ ] 四个 Tab 能切换；各页滚动位置与底部安全区正确。
- [ ] 发现页卡片 → 详情 → 穿上这件 → 试衣间，衣服 ID 正确保留。
- [ ] 写实/动漫图库切换、搜索（中文/英文）、分类、上拉加载、下拉刷新正确。
- [ ] ID `real:SPR-0001` 和 `anime:SPR-0001` 不冲突。
- [ ] 收藏在重启后仍然存在；游客不强制登录。
- [ ] 图片加载失败有占位，网络恢复可重试。
- [ ] 拒绝照片权限时有可理解提示；照片未选择时禁止生成。
- [ ] 无后端配置时**不会模拟成功结果**，有清晰的“未配置服务端”提示。
- [ ] 真生成需认证/额度校验；连点不会产生多次扣费。
- [ ] 生成任务成功/失败/超时/切后台恢复状态正确。
- [ ] 用户可删除生成历史，并按预期删除后端结果图。
- [ ] 微信真机可加载合法 CDN 域名、可保存图片；Android 真机至少完成同样核心链路。
- [ ] 无任何生产 API Key / Bearer Token 被硬编码在源码、`dist/` 或网络请求日志中。

### 12.3 最终交付物

```text
mobile/                 # 可运行完整 unibest 代码
backend/（增量改动）      # GoFrame API / 试衣网关；不破坏原网站
scripts/export-catalog.*
mobile/.env.example      # 只有示例地址，没有真实密钥
docs/MOBILE_API_SPEC.md  # 按实际已实现接口更新
docs/TEST_REPORT.md      # H5/微信/Android 构建与冒烟结果
README-mobile.md         # 安装、运行、构建、联调、部署步骤
```

提交时必须说明：**哪些功能真实联调通过；哪些仍用 mock；哪些因缺 AppID/服务端 Key/设备无法测试**，避免凭空宣称全平台完整可用。

---

## 13. 可直接复制给编码 AI 的开发指令

> 请实现 `https://github.com/paipiange/nvzhuang` 的移动端 App / 微信小程序。技术栈严格使用 **uni-app + Vue3 + TypeScript + unibest + Pinia + UnoCSS + Wot UI**，独立放在仓库 `mobile/`。已有 UI 参考 `nvzhuang-ui.html` 和 `nvzhuang-ui-preview.png`；请严格还原「奶油白 + 玫瑰粉」的四 Tab 设计（发现、图库、试衣间、我的），包含详情、收藏、AI 模特选择、历史与结果页。禁止直接通过 `web-view` 嵌入旧网站。请先核实 unibest 最新脚手架和源仓库现有 GoFrame `/tryon` 接口，然后按 `nvzhuang-tech.md` 的阶段 A→B→C→D 开发：前期允许明确的 mock，但最终涉及真实生成时必须通过新 GoFrame 安全网关调用现有换装逻辑，不能伪造生成成功。服装/动漫/AI 模特数据必须用真实数据与图片 URL，不将全量图片打包进小程序；游客可以浏览和本地收藏。微信、Android、H5 要有安全区、图片上传与保存适配。每阶段运行检查、构建与测试；修改源码，不要只给文字方案；不要覆盖未提交代码，不要自动推送。最终给出运行命令、文件树、真实已实现功能与测试报告。

---

## 14. 参考资料（供执行 AI 联网核对）

- 原项目源码：<https://github.com/paipiange/nvzhuang>
- 原项目 README：<https://github.com/paipiange/nvzhuang/blob/main/README.md>
- 已有后端接口定义：<https://github.com/paipiange/nvzhuang/blob/main/backend/api/tryon/v1/tryon.go>
- 后端路由：<https://github.com/paipiange/nvzhuang/blob/main/backend/internal/cmd/cmd.go>
- unibest 官方文档：<https://www.unibest.tech/>
- unibest 快速开始：<https://www.unibest.tech/base/2-start>
- unibest 请求篇：<https://www.unibest.tech/base/8-request>
- unibest 构建发布：<https://www.unibest.tech/base/11-build>
- uni-app 官方文档：<https://uniapp.dcloud.net.cn/>

**说明**：上面有关 unibest 初始化、路由、请求配置等使用方式依据 2026-11-07 查阅的官方资料；执行时仍应优先查看最新脚手架生成的 `package.json`、配置和官方说明，避免版本漂移造成错误。
